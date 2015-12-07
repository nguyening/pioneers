var EventEmitter = require('events').EventEmitter;
var util = require('util');

var bunyan = require('bunyan');
var promise = require('es6-promise').Promise;
var uuid = require('node-uuid');

var log = bunyan.createLogger({ name: 'websocket-client', level: 'info' });

var Client = function (ws, id) {
	if (!(this instanceof Client)) { return new Client(id); }
	if (id === undefined) {
		id = uuid.v4();
	}

	EventEmitter.call(this);

	this.id = id;
	this._ws = ws;
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
		
		client._ws.on('message', function (data, flags) {
			client.emit('message', data, flags);
		});

		return client;
	});
};
