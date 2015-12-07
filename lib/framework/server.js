var EventEmitter = require('events').EventEmitter;
var path = require('path');
var util = require('util');

var bunyan = require('bunyan');
var Promise = require('es6-promise').Promise;
var wss = require('ws').Server;

var Client = require('./client');

var log = bunyan.createLogger({ name: 'ws-server', level: 'info' });

var Server = function () {
	if (!(this instanceof Server)) { return new Server(); }

	EventEmitter.call(this);
};
util.inherits(Server, EventEmitter);

exports.initialize = function (httpServer) {
	var server = new Server();

	return new Promise(function (resolve, reject) {
		var webSocketServer = new wss({server: httpServer});

		log.info('Setting up WebSocket server ...');
		resolve(webSocketServer);
	})
	.then(function (webSocketServer) {
		server._webSocketServer = webSocketServer;
	})
	.then(function () {
		log.debug('Exposing internal server component events ...');

		server._webSocketServer.on('error', function (err) {
			log.error('Error occurred in WebSocket server', err, err.stack);
			server.emit('error', err);
			wsServer.close();
		});

		server._webSocketServer.on('connection', function (ws) {
			var room = ws.upgradeReq.url.substring(1);
			var client = Client
				.initialize(ws)
				.then(function (client) {
					return client.join(room);
				})
				.then(function (client) {
					server.emit('clientConnect', client);
				})
				.catch(function (err) {
					log.error('Error creating client for WebSocket connection', err, err.stack);
				});
		});

		return server;
	});
};
