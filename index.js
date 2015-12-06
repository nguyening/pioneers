#!/usr/bin/env node
var http = require('http'),
	path = require('path'),
	util = require('util');

var amqp = require('amqp'),
	bunyan = require('bunyan'),
	bodyParser = require('body-parser'),
	express = require('express'),
	promise = require('es6-promise').Promise,
	uuid = require('node-uuid'),
	wss = require('ws').Server;

var HOST = '0.0.0.0';
var PORT = 3000;
var log = bunyan.createLogger({ name: 'pioneers', level: 'debug' });

var setupWebServer = function(app) {
	return new Promise(function(resolve, reject) {
		log.info('Setting up web server listening on %s:%d ...', HOST, PORT);
		var server = app.listen(PORT, HOST, function(err) {
			if (err) { reject(err); }

			resolve(server);
		});
	});
};
var setupWebSocketServer = function(server) {
	return new Promise(function(resolve, reject) {
		log.info('Setting up WebSocket server ...');
		var wsServer = new wss({ server: server });

		resolve(wsServer);
	});
};
var setupMQ = function() {
	return new Promise(function(resolve, reject) {
		log.info('Setting up rabbitMQ client ...');
		var connection = amqp.createConnection({ 
			host: 'localhost', 
			clientProperties: {
				applicationName: 'pioneers',
				capabilities: {}
			}
		});

		connection.on('ready', function() {
			resolve(connection);
		});
	});
};
var setupMQBinds = function(mq) {
	// Two exchanges that always have to exist
	log.info('Setting up static rabbitMQ exchanges ...');
	var exchanges = ['server-to-user', 'user-to-server'];
	return Promise.all(exchanges.map(function(exchangeName) {
		log.debug('Creating exchange %s ...', exchangeName);
		return new Promise(function(resolve, reject) {
			mq.exchange(exchangeName, { type: 'topic', autoDelete: false }, function(exchange) {
				resolve(exchange);
			}).on('error', function(err) { reject(err); });
		});
	}));
};
var setupMonitor = function(res) {
	var mq = res[0],
		exchanges = res[1];

	log.info('Setting up monitor ...');
	var monitorID = uuid.v4(),
		routingKey = '#',
		exchangeName = exchanges[1].name;

	return new Promise(function(resolve, reject) {
		mq.queue(util.format('monitor.%s', monitorID), { exclusive: true, autoDelete: true }, function(queue) {
			log.debug('Creating binding with routingKey %s between queue %s and exchange %s', routingKey, queue.name, exchangeName);
			queue.bind(exchangeName, routingKey);

			queue.on('queueBindOk', function() {
				resolve(queue);
			});
		}).on('error', function(err) { reject(err); });
	});
};

var app = express();

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

var p_app = Promise.resolve(app),
	p_server = p_app.then(setupWebServer),
	p_wsServer = p_server.then(setupWebSocketServer),
	p_mq = Promise.resolve().then(setupMQ),
	p_mqExchanges = p_mq.then(setupMQBinds),
	p_monitor = Promise.all([p_mq, p_mqExchanges]).then(setupMonitor);

Promise.all([p_app, p_server, p_wsServer, p_mq, p_mqExchanges, p_monitor]).then(function(res) {
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
			exchangeName = serverToUser.name,
			clientID = uuid.v4();

		log.info('Client %s has connected', clientID);

		// Create temporary queues for this client
		var properties = [
			{ queue: util.format('client.%s.public', clientID), routingKey: util.format('room.%s.broadcast.#', room) },
			{ queue: util.format('client.%s.private', clientID), routingKey: util.format('room.%s.client.%s.#', room, clientID) }
		];

		Promise.all(properties.map(function(prop) {
			log.debug('Creating queue %s for client %s ...', prop.queue, clientID);
			return new Promise(function(resolve, reject) {
				mq.queue(prop.queue, { exclusive: true, autoDelete: true }, function(queue) {
					log.debug('Creating binding with routingKey %s between queue %s and exchange %s', 
						prop.routingKey, queue.name, exchangeName);
					queue.bind(exchangeName, prop.routingKey);

					queue.on('queueBindOk', function() {
						resolve(queue);
					});
				}).on('error', function(err) { reject(err); });
			});
		})).then(function(queues) {
			log.info('Set up queue forwarding over websocket ...');
			queues.forEach(function(queue) {
				queue.subscribe(function(message, headers, deliveryInfo, messageObj) {
					if (message.data instanceof Buffer) {
						message = message.data.toString('utf8');
					}
					ws.send(message, function() {
						log.debug('Sent message to client', message);
					});
				});
			});

			log.info('Binding events to client websocket ...');
			ws.on('message', function(data, flags) {
				var payload = JSON.parse(data);

				log.debug('Client %s has sent data', clientID, data, flags);
				userToServer.publish(util.format('client.%s.%s', clientID, payload.action), payload.data); 
			});

			ws.on('error', function(err) {
				log.error('Client %s has encountered an error', clientID, err, err.stack);
				queues.forEach(function(queue) {
					queue.destroy();
				});
				ws.close();
			});

			ws.on('close', function() {
				queues.forEach(function(queue) {
					queue.destroy();
				});
				log.info('Client %s has disconnected', clientID);
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
