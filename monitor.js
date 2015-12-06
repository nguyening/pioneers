var util = require('util');

var bunyan = require('bunyan'),
	Promise = require('es6-promise').Promise,
	uuid = require('node-uuid');

var amqp = require('./lib/amqpPromise');

var log = bunyan.createLogger({ name: 'pioneers-monitor', level: 'debug' });

var setupMonitor = function(mq, exchanges) { 
	log.info('Setting up monitor ...');
	var monitorID = uuid.v4(),
		routingKey = '#',
		exchangeName = exchanges[1]._exchange.name;

	return mq.queue(util.format('monitor.%s', monitorID), { exclusive: true, autoDelete: true }).then(function(queue) {
		return queue.bind(exchangeName, routingKey);
	}).then(function(queue) {
		return queue.subscribe(function(message, headers, deliveryInfo, messageObj) {
			if (message.data instanceof Buffer) {
				message = message.data.toString('utf8');
			}
			log.debug('Got message from client', message);
					
		});
	});
};

exports.initialize = function(mq, exchanges) {
	return setupMonitor(mq, exchanges);
};
