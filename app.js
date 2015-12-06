#!/usr/bin/env node
var http = require('http');
var util = require('util');

var bunyan = require('bunyan');
var promise = require('es6-promise').Promise;

var amqpPromise = require('./lib/amqpPromise');
var Server = require('./server');
var monitor = require('./monitor');
		
var HOST = '0.0.0.0';
var PORT = 3000;

var log = bunyan.createLogger({ name: 'pioneers', level: 'debug' });

var setupMQ = Promise.resolve().then(function () {
	log.info('Setting up rabbitMQ client ...');
	
	return amqpPromise.connect({
		host: 'localhost', 
		clientProperties: {
			applicationName: 'pioneers',
			capabilities: {}
		}
	});
});
var setupExchanges = setupMQ.then(function (mq) {
	var exchanges = ['server-to-user', 'user-to-server'].map(function (exchangeName) {
		log.debug('Creating exchange %s ...', exchangeName);

		return mq.exchange(exchangeName, {type: 'topic', autoDelete: false});
	});

	log.info('Setting up static rabbitMQ exchanges ...');

	return Promise.all(exchanges);
});
var setupServer = Server.initialize({host: HOST, port: PORT});
var setupMonitor = Promise.all([setupMQ, setupExchanges]).then(function (res) {
	var mq = res[0];
	var exchanges = res[1];

	return monitor.initialize(mq, exchanges);
});

var setup = Promise.all([setupServer, setupMQ, setupExchanges, setupMonitor])
	.then(function (res) {
		var server = res[0];
		var mq = res[1];
		var mqExchanges = res[2];
		var monitor = res[3];

		var app = server._express;
		var httpServer = server._httpServer;
		var wsServer = server._webSocketServer;
		var serverToUser = mqExchanges[0];
		var userToServer = mqExchanges[1];

		server.on('error', function(err) {
			log.error('Error occurred on the server', err, err.stack);

		});

		server.on('clientConnect', function(client) {
			var exchangeName = serverToUser._exchange.name;
			var clientQueues = Promise.resolve(client).then(function (client) {
				log.info('Client %s has connected', client.id);
				
				// Create temporary queues for this client
				log.info('Creating client queues ...');
				var queues = [
					{ 
						queue: util.format('client.%s.public', client.id), 
						routingKey: util.format('room.%s.broadcast.#', client.room) 
					},
					{ 
						queue: util.format('client.%s.private', client.id), 
						routingKey: util.format('room.%s.client.%s.#', client.room, client.id) 
					}
				].map(function (prop) {
					log.debug('Creating queue %s for client %s ...', prop.queue, client.id);

					return mq
						.queue(prop.queue, {
							exclusive: true, 
							autoDelete: true 
						})
						.then(function (queue) {
							log.debug('Creating binding with routingKey %s between queue %s and ' + 
								'exchange %s', prop.routingKey, prop.queue, exchangeName);

							return queue.bind(exchangeName, prop.routingKey);
						})
						.then(function (queue) {
							log.debug('Set up queue forwarding over websocket ...'); 

							return queue.subscribe(function (message, headers, deliveryInfo, messageObj) {
								if (message.data instanceof Buffer) {
									message = message.data.toString('utf8');
								}

								client
									.send(message)
									.then(function () {
										log.debug('Sent message to client', message);
									});
							});
						});
				});

				return Promise.all(queues);
			});
				
			return Promise.all([client, clientQueues]).then(function (res) {
				var client = res[0];
				var queues = res[1];

				log.info('Setting up client event binds ...');
				client.on('send', function (data, flags) {
					var payload = JSON.parse(data);

					log.debug('Client %s has sent data', client.id, data, flags);
					userToServer
						.publish(util.format('client.%s.%s', client.id, payload.action), payload.data)
						.then(function (exchange) {
							log.debug('Passed client %s data onto monitor\'s exchange', client.id);	
						}); 
				});

				client.on('error', function (err) {
					var destroyedQueues = queues.map(function (queue) { 
						return queue.destroy(); 
					});

					return Promise.all(destroyedQueues).then(function () {
						log.error('Client %s has encountered an error', client.id, err, err.stack);
					});
				});

				client.on('close', function () {
					var destroyedQueues = queues.map(function (queue) { 
						return queue.destroy(); 
					});

					return Promise.all(destroyedQueues).then(function () {
						log.info('Client %s has disconnected', client.id);
					});
				});

				client.on('message', function (data, flags) {
					// TODO: Pull out to message queue class
					client.emit('send', data, flags);
				});

				log.info('Finished client %s set up', client.id);

				return client;
			}).catch(function (err) {
				log.error('Error setting up client', err, err.stack);	
			});
		});
	})
	.then(function () {
		log.info('Everything is good to go capt!');	
	})
	.catch(function (err) {
		log.error('Error setting up components', err, err.stack);	
	});
