var EventEmitter = require('events').EventEmitter;
var util = require('util');

var bunyan = require('bunyan');
var Promise = require('es6-promise').Promise;
var uuid = require('node-uuid');

var log = bunyan.createLogger({ name: 'pioneers-logic', level: 'debug' });

var Monitor = function (id) {
	if (!(this instanceof Monitor)) { return new Monitor(id); }
	if (id === undefined) {
		id = uuid.v4();
	}

	EventEmitter.call(this);

	this.id = id;
};
util.inherits(Monitor, EventEmitter);

Monitor.prototype.ingest = function (message, headers, deliveryInfo) {
	var action = headers.action;
	var client = headers.client;
	var room = headers.room;
	var route = util.format('broadcast.client.%s.%s', client, action);

	log.debug('User event', headers, deliveryInfo, message);
	this.emit('publish', room, route, message);
};

exports.initialize = function () {
	return new Promise(function (resolve, reject) {
		var monitor = new Monitor();

		resolve(monitor);
	});
};
