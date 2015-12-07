var amqp = require('amqp'),
	Promise = require('es6-promise').Promise;

// TODO: Mirror object properties
var ExchangePromise = function (exchange) {
	if (!(this instanceof ExchangePromise)) { return new ExchangePromise(exchange); }

	this._exchange = exchange;
};
ExchangePromise.prototype.publish = function (routingKey, message, options) {
	var self = this;

	return new Promise(function (resolve, reject) {

		// Note that these exchanges are not in `confirm` mode, and thus a callback
		// provided to the publish function will not be invoked.

		self._exchange.publish(routingKey, message, options);
		resolve(self);
	});
};

var QueuePromise = function (queue) {
	if (!(this instanceof QueuePromise)) { return new QueuePromise(queue); }

	this._queue = queue;
};
QueuePromise.prototype.bind = function (exchange, routingKey) {
	var self = this;

	return new Promise(function (resolve, reject) {
		self._queue.bind(exchange, routingKey);
		self._queue.on('queueBindOk', function () {
			resolve(self);
		});
	});
};
QueuePromise.prototype.subscribe = function (options, messageListener) {
	var self = this;

	return new Promise(function (resolve, reject) {
		self._queue
			.subscribe(options, messageListener)
			.addCallback(function (ok) {
				resolve(ok.consumerTag);
			});
	});
};
QueuePromise.prototype.unsubscribe = function (consumerTag) {
	var self = this;

	return new Promise(function (resolve, reject) {
		self._queue.unsubscribe(consumerTag);
		resolve();
	});
};
QueuePromise.prototype.destroy = function () {
	var self = this;

	return new Promise(function (resolve, reject) {
		self._queue.destroy();
		resolve();
	});
};

var AMQPPromise = function (connection) {
	if (!(this instanceof AMQPPromise)) { return new AMQPPromise(connection); }

	this._connection = connection;
};

AMQPPromise.prototype.exchange = function (name, options) {
	var self = this;
	return new Promise(function (resolve, reject) {
		self._connection.exchange(name, options, function (exchange) {
			resolve(ExchangePromise(exchange));
		});
	});
};
AMQPPromise.prototype.queue = function (name, options) {
	var self = this;

	return new Promise(function (resolve, reject) {
		self._connection.queue(name, options, function (queue) {
			resolve(QueuePromise(queue));
		});
	});
};

exports.connect = function (options, implOptions) {
	return new Promise(function (resolve, reject) {
		var connection = amqp.createConnection(options, implOptions);

		connection.on('ready', function () {
			resolve(AMQPPromise(connection));
		});
	});
};
exports.AMQPPromise = AMQPPromise;
