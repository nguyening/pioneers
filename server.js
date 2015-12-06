var EventEmitter = require('events').EventEmitter;
var path = require('path');
var util = require('util');

var bunyan = require('bunyan');
// var bodyParser = require('body-parser');
var express = require('express');
var Promise = require('es6-promise').Promise;
var wss = require('ws').Server;

var Client = require('./client');

var log = bunyan.createLogger({ name: 'pioneers-server', level: 'debug' });

var Server = function (options) {
	if (!(this instanceof Server)) { return new Server(options); }

	EventEmitter.call(this);

	this.host = options.host || '0.0.0.0';
	this.port = options.port || 80;
};
util.inherits(Server, EventEmitter);

exports.initialize = function (options) {
	var server = new Server(options);
	var app = express();

	log.info('Setting up Express middleware ...');
	app.set('views', __dirname + '/views');
	app.set('view engine', 'jade');
	// app.use(bodyParser.json());
	app.use(express.static(path.join(__dirname, 'public')));

	app.get('/', function (req, res) {
		res.render('index.jade', {title: 'Main page'});
	});

	var setupHTTP = new Promise(function (resolve, reject) {
		var httpServer = app.listen(server.port, server.host, function (err) {
			if (err) { reject(err); }

			resolve(httpServer);
		});

		log.info('Setting up web server listening on %s:%d ...', server.host, server.port);
	});
	var setupWSS = setupHTTP.then(function (server) {
		return new Promise(function (resolve, reject) {
			var webSocketServer = new wss({server: server});

			log.info('Setting up WebSocket server ...');
			resolve(webSocketServer);
		});
	});

	return Promise.all([setupHTTP, setupWSS]).then(function (res) {
		server._express = app;
		server._httpServer = res[0];
		server._webSocketServer = res[1];
	}).then(function () {
		log.info('Exposing internal server component events ...');

		// TODO: Add more context for error emissions?
		// Potentially add in which component of the server failed.
		server._webSocketServer.on('error', function (err) {
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
					log.error('Error creating client for websocket connection', err, err.stack);
				});
		});

		return server;
	});
};
