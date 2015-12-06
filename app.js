#!/usr/bin/env node
var http = require('http'),
	util = require('util');

var bunyan = require('bunyan'),
	promise = require('es6-promise').Promise;

var amqpPromise = require('./lib/amqpPromise'),
	server = require('./server'),
	monitor = require('./monitor'),
	Client = require('./client');
		
var log = bunyan.createLogger({ name: 'pioneers', level: 'debug' });

var setupMQ = Promise.resolve().then(function() {
	log.info('Setting up rabbitMQ client ...');

	return amqpPromise.connect({
		host: 'localhost', 
		clientProperties: {
			applicationName: 'pioneers',
			capabilities: {}
		}
	});
}),
	setupExchanges = setupMQ.then(function(mq) {
	// Two exchanges that always have to exist
	log.info('Setting up static rabbitMQ exchanges ...');

	var exchanges = ['server-to-user', 'user-to-server'];
	return Promise.all(exchanges.map(function(exchangeName) {
		log.debug('Creating exchange %s ...', exchangeName);
		return mq.exchange(exchangeName, { type: 'topic', autoDelete: false });
	}));
}),
	setupServer = server.initialize(),
	setupMonitor = Promise.all([setupMQ, setupExchanges]).then(function(res) {
	var mq = res[0],
		exchanges = res[1];

	return monitor.initialize(mq, exchanges);
});

Promise.all([setupServer, setupMQ, setupExchanges, setupMonitor]).then(function(res) {
	var server = res[0],
		mq = res[1],
		mqExchanges = res[2],	// server-to-user, user-to-server
		monitor = res[3];

	var app = server[0],
		httpServer = server[1],
		wsServer = server[2];

	var serverToUser = mqExchanges[0],
		userToServer = mqExchanges[1];

	wsServer.on('error', function(err) {
		log.error('Error occurred on WebSocket server', err, err.stack);
		wsServer.close();
	});

	wsServer.on('connection', function(ws) {
		var room = ws.upgradeReq.url.substring(1),
			exchangeName = serverToUser._exchange.name;

		var client = Client.initialize(),
			clientQueues = client.then(function(client) {
			log.info('Client %s has connected', client.id);
			
			// Create temporary queues for this client
			log.info('Creating client queues ...');
			var queues = [
				{ queue: util.format('client.%s.public', client.id), routingKey: util.format('room.%s.broadcast.#', room) },
				{ queue: util.format('client.%s.private', client.id), routingKey: util.format('room.%s.client.%s.#', room, client.id) }
			].map(function(prop) {
				log.debug('Creating queue %s for client %s ...', prop.queue, client.id);

				return mq.queue(prop.queue, { exclusive: true, autoDelete: true }).then(function(queue) {
					log.debug('Creating binding with routingKey %s between queue %s and exchange %s', 
						prop.routingKey, prop.queue, exchangeName);

					return queue.bind(exchangeName, prop.routingKey);
				}).then(function(queue) {
					log.debug('Set up queue forwarding over websocket ...'); 

					return queue.subscribe(function(message, headers, deliveryInfo, messageObj) {
						if (message.data instanceof Buffer) {
							message = message.data.toString('utf8');
						}
						ws.send(message, function() {
							log.debug('Sent message to client', message);
						});
					});
				});
			});

			return Promise.all(queues);
		});
			
		return Promise.all([client, clientQueues]).then(function(res) {;
			var client = res[0],
				queues = res[1];

			log.info('Setting up client event binds ...');
			client.on('send', function(data, flags) {
				var payload = JSON.parse(data);

				log.debug('Client %s has sent data', client.id, data, flags);
				userToServer.publish(util.format('client.%s.%s', client.id, payload.action), payload.data).then(function(exchange) {
					log.debug('Passed client %s data onto monitor\'s exchange', client.id);	
				}); 
			});

			ws.on('error', function(err) {
				return Promise.all(queues.map(function(queue) { return queue.destroy(); })).then(function() {
					log.error('Client %s has encountered an error', client.id, err, err.stack);
				});
			});

			ws.on('close', function() {
				return Promise.all(queues.map(function(queue) { return queue.destroy(); })).then(function() {
					log.info('Client %s has disconnected', client.id);
				});
			});

			ws.on('message', function(data, flags) {
				client.emit('send', data, flags);
			});

			log.info('Finished client %s set up', client.id);
			return client;
		}).catch(function(err) {
			log.error('Error setting up client', err, err.stack);	
		});
	});
}).then(function() {
	log.info('Everything is good to go capt!');	
}).catch(function(err) {
	log.error('Error setting up components', err, err.stack);	
});
