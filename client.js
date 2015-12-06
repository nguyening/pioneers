var EventEmitter = require('events').EventEmitter,
	util = require('util');

var bunyan = require('bunyan'),
	promise = require('es6-promise').Promise,
	uuid = require('node-uuid');

var log = bunyan.createLogger({ name: 'pioneers-client', level: 'debug' });

var Client = function (ws, id) {
	if (!(this instanceof Client)) { return new Client(id); }
	if (id === undefined) {
		id = uuid.v4();
	}

	this.id = id;
	this._ws = ws;
	EventEmitter.call(this);
};
util.inherits(Client, EventEmitter);
Client.prototype.join = function (room) {
	var self = this;

	return new Promise(function (resolve, reject) {
		self.room = room;

		resolve(self);
	});
};
Client.prototype.send = function (data) {
	var self = this;

	return new Promise(function (resolve, reject) {
		return self._ws.send(data);
	});
};

exports.initialize = function (ws) {
	return new Promise(function (resolve, reject) {
		resolve(new Client(ws));
	}).then(function (client) {
		client._ws.on('error', function (err) {
			client.emit('error', err);
			client._ws.close();
		});

		client._ws.on('close', function () {
			client.emit('close');
		});
		
		client._ws.on('message', function (msg) {
			client.emit('message', msg);
		});

		return client;
	});
};
