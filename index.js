#!/usr/bin/env node
var http = require('http'),
	path = require('path'),
	util = require('util');

var bunyan = require('bunyan'),
	bodyParser = require('body-parser'),
	express = require('express'),
	promise = require('es6-promise').Promise,
	uuid = require('node-uuid'),
	wss = require('ws').Server;

var amqpPromise = require('./lib/amqpPromise');

var HOST = '0.0.0.0';
var PORT = 3000;
var app = express();
var log = bunyan.createLogger({ name: 'pioneers', level: 'debug' });

log.info('Setting up Express middleware ...');
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
//app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res) {
	res.render('index.jade', {
		title: 'Main page'
	});
});

var setupApp = Promise.resolve(app),
	setupServer = setupApp.then(function(app) {
		return new Promise(function(resolve, reject) {
			log.info('Setting up web server listening on %s:%d ...', HOST, PORT);
			var server = app.listen(PORT, HOST, function(err) {
				if (err) { reject(err); }

				resolve(server);
			});
		});
	}),
	setupWSServer = setupServer.then(function(server) {
		return new Promise(function(resolve, reject) {
			log.info('Setting up WebSocket server ...');
			var wsServer = new wss({ server: server });

			resolve(wsServer);
		});
	}),
	setupMQ = Promise.resolve().then(function() {
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
	setupMonitor = Promise.all([setupMQ, setupExchanges]).then(function(res) {
		var mq = res[0],
			exchanges = res[1];

		log.info('Setting up monitor ...');
		var monitorID = uuid.v4(),
			routingKey = '#',
			exchangeName = exchanges[1]._exchange.name;

		log.info(monitorID, routingKey, exchangeName);
		return mq.queue(util.format('monitor.%s', monitorID), { exclusive: true, autoDelete: true }).then(function(queue) {
			return queue.bind(exchangeName, routingKey);
		});
	});

Promise.all([setupApp, setupServer, setupWSServer, setupMQ, setupExchanges, setupMonitor]).then(function(res) {
	var app = res[0],
		server = res[1],
		wsServer = res[2],
		mq = res[3],
		mqExchanges = res[4];	// server-to-user, user-to-server

	var serverToUser = mqExchanges[0],
		userToServer = mqExchanges[1];

	wsServer.on('error', function(err) {
		log.error('Error occurred on WebSocket server', err, err.stack);
		wsServer.close();
	});

	wsServer.on('connection', function(ws) {
		var room = ws.upgradeReq.url.substring(1),
			exchangeName = serverToUser._exchange.name,
			clientID = uuid.v4();

		log.info('Client %s has connected', clientID);

		// Create temporary queues for this client
		var properties = [
			{ queue: util.format('client.%s.public', clientID), routingKey: util.format('room.%s.broadcast.#', room) },
			{ queue: util.format('client.%s.private', clientID), routingKey: util.format('room.%s.client.%s.#', room, clientID) }
		];

		log.info('Creating client queues ...');
		var queues = Promise.all(properties.map(function(prop) {
			log.debug('Creating queue %s for client %s ...', prop.queue, clientID);
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
		})).then(function(queues) {
			log.info('Binding events to client websocket ...');
			ws.on('message', function(data, flags) {
				var payload = JSON.parse(data);

				log.debug('Client %s has sent data', clientID, data, flags);
				userToServer.publish(util.format('client.%s.%s', clientID, payload.action), payload.data).then(function(exchange) {
					log.debug('Passed client %s data onto monitor\'s exchange', clientID);	
				}); 
			});

			ws.on('error', function(err) {
				log.error('Client %s has encountered an error', clientID, err, err.stack);
				Promise.all(queues.map(function(queue) {
					return queue.destroy();
				})).then(function() {
					ws.close();
				});
			});

			ws.on('close', function() {
				Promise.all(queues.map(function(queue) {
					return queue.destroy();
				})).then(function() {
					log.info('Client %s has disconnected', clientID);
				});
			});
		}).then(function() {
			log.info('Finished client %s set up', clientID);	
		}).catch(function(err) {
			log.error('Error setting up client', err, err.stack);	
		});
	});
}).then(function() {
	log.info('Everything is good to go capt!');	
}).catch(function(err) {
	log.error('Error setting up components', err, err.stack);	
});
