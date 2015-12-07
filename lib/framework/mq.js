var EventEmitter = require('events').EventEmitter;
var util = require('util');

var _ = require('lodash');
var bunyan = require('bunyan');
var Promise = require('es6-promise').Promise;

var amqpPromise = require('./util/amqpPromise');

var log = bunyan.createLogger({ name: 'rabbitmq-mq', level: 'info' });

var MQ = function (amqp, exchanges) {
	if (!(this instanceof MQ)) { return new MQ(amqp, exchanges); }	

	EventEmitter.call(this);

	this._amqp = amqp;
	this._exchanges = exchanges;
	this._consumerMap = {};
};
util.inherits(MQ, EventEmitter);

MQ.prototype._addQueue = function (options) {
	var self = this;

	log.debug('Adding queue ...', options);
	var name = options.name || '';
	var exchange = options.exchange || '';
	var routingKey = options.routingKey || '#';
	var consume = options.consume || null;

	return self._amqp
		.queue(name, {
			exclusive: true, 
			autoDelete: true 
		})
		.then(function (queue) {
			log.debug('Creating binding with routingKey %s between queue %s and ' + 
				'exchange %s', routingKey, name, exchange);

			return queue.bind(exchange, routingKey);
		})
		.then(function (queue) {
			if (consume !== null) {
				log.debug('Consume function given, subscribing to queue immediately');
				return queue.subscribe(consume);
			} else {
				throw new Error('No consume function given and queues are subscribed to immediately');
			}
		})
		.then(function (consumerTag) {
			if (self._consumerMap[name] === undefined) {
				self._consumerMap[name] = [];	
			}

			log.debug('Adding ctag %s for queue %s ...', consumerTag, name);
			self._consumerMap[name].push(consumerTag);
		});
};
MQ.prototype._removeQueue = function (name) {
	var self = this;

	return self._amqp
		.queue(name, {noDeclare: true})
		.then(function (queue) {
			if (self._consumerMap[name] && self._consumerMap[name].length !== 0) {
				var unsubscriptions = self._consumerMap[name].map(function (consumerTag) {
					log.debug('Unsubscribing ctag %s from queue %s ...', consumerTag, name);
					return queue.unsubscribe(consumerTag);
				});

				return Promise.all(unsubscriptions).then(function () { 
					log.debug('Clearing ctags for queue %s ...', name);
					delete self._consumerMap[name];
					return queue; 
				}).catch(function (err) { log.error('Issue unsubscribing', err, err.stack); });
			}

			return queue;
		})
		.then(function (queue) {
			log.debug(self._consumerMap[name]);
			log.debug('Destroying queue %s ...', name);
			return queue.destroy();
		});
};
MQ.prototype.addClientQueue = function (options) {
	var self = this;

	return self._addQueue(_.defaults({
		exchange: self._exchanges[0]._exchange.name
	}, options));
};
MQ.prototype.removeClientQueue = MQ.prototype.removeServerQueue = function (name) {
	var self = this;

	log.debug('Removing queue %s ...', name);
	return self._removeQueue(name);
};
MQ.prototype.addServerQueue = function (options) {
	var self = this;

	return self._addQueue(_.defaults({
		exchange: self._exchanges[1]._exchange.name
	}, options));
};
MQ.prototype.publishClientExchange = function (routingKey, data, options) {
	return this._exchanges[1].publish(routingKey, data, options);
};
MQ.prototype.publishServerExchange = function (routingKey, data, options) {
	return this._exchanges[0].publish(routingKey, data, options);
};


exports.initialize = function (host) {
	log.info('Setting up rabbitMQ client at %s ...', host);
	var amqp = amqpPromise.connect({
		host: host, 
		clientProperties: {
			applicationName: 'rabbitmq-mq',
			capabilities: {}
		}
	});

	var exchanges = amqp.then(function (mq) {
		var exchangeNames = ['server-to-user', 'user-to-server'].map(function (exchangeName) {
			log.debug('Creating exchange %s ...', exchangeName);

			return mq.exchange(exchangeName, {type: 'topic', autoDelete: false});
		});

		log.debug('Setting up static rabbitMQ exchanges ...');

		return Promise.all(exchangeNames);
	});

	return Promise.all([amqp, exchanges]).then(function (res) {
		log.debug('Set up everything for mq, constructing wrapper ...');
		var mq = new MQ(res[0], res[1]);

		return mq;
	});
};
