var EventEmitter = require('events').EventEmitter,
	util = require('util');

var bunyan = require('bunyan'),
	promise = require('es6-promise').Promise,
	uuid = require('node-uuid');

var log = bunyan.createLogger({ name: 'pioneers-client', level: 'debug' });

var Client = function(id) {
	if (!(this instanceof Client)) { return new Client(id); }
	if (id === undefined) {
		id = uuid.v4();
	}

	this.id = id;
	EventEmitter.call(this);
};
util.inherits(Client, EventEmitter);

exports.initialize = function() {
	return new Promise(function(resolve, reject) {
		resolve(new Client());
	});
};
