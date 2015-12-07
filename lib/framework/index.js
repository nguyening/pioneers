var EventEmitter = require('events').EventEmitter;
var util = require('util');

var bunyan = require('bunyan');
var promise = require('es6-promise').Promise;

var Server = require('./server');
var MQ = require('./mq');
		

var Framework = function(mqHost, logLevel) {
	if (!(this instanceof Framework)) { return new Framework(mqHost, logLevel); }

	EventEmitter.call(this);

	this.mqHost = mqHost;
	this.logLevel = logLevel || 'info';
};
util.inherits(Framework, EventEmitter);

Framework.prototype.setup = function(httpServer, monitor) {
	var self = this;

	var setupMQ = MQ.initialize(this.mqHost);
	var setupServer = Server.initialize(httpServer);
	var log = bunyan.createLogger({ name: 'framework', level: this.logLevel });

	return Promise.all([setupServer, setupMQ])
		.then(function (res) {
			log.debug('Finished internal sources setup');
			var server = res[0];
			var mq = res[1];

			server.on('error', function(err) {
				log.error('Error occurred on the server', err, err.stack);
			});

			server.on('clientConnect', function(client) {
				return Promise.resolve(client)
					.then(function (client) {
						log.info('Client %s has connected', client.id);
						log.debug('Setting up client event binds ...');
					
						client.on('error', function (err) {
							log.error('Client %s has encountered an error', client.id, err, err.stack);
						});

						client.on('close', function () {
							var destroyedQueues = [
								util.format('client.%s.public', client.id), 
								util.format('client.%s.private', client.id)
							].map(function (name) {
								return mq.removeClientQueue(name);	
							});

							return Promise.all(destroyedQueues).then(function () {
								log.info('Client %s has disconnected', client.id);
							});
						});

						client.on('message', function (data, flags) {
							client.emit('receive', data, flags);
						});

						client.on('receive', function (data, flags) {
							Promise.resolve()
								.then(function () {
									var payload = JSON.parse(data);
									var routingKey = util.format('client.%s.%s', client.id, payload.action);

									log.debug('Client %s has sent data', client.id, data, flags);

									return mq
										.publishClientExchange(routingKey, payload.data, {
											headers: {
												room: client.room,
												client: client.id,
												action: payload.action
											}
										})
										.then(function () {
											log.debug('Passed client %s data onto monitor\'s exchange', client.id);	
										}); 
								})
								.catch(function (err) {
									log.error('Error parsing client %s WebSocket input', client.id, data, err, err.stack);
								});
						});

						log.debug('Creating client queues ...');
						var consumeFunc = function (message, headers, deliveryInfo, messageObj) {
							if (message.data instanceof Buffer) {
								message = message.data.toString('utf8');
							}

							client
								.send(message)
								.then(function () {
									log.debug('Sent message to client', message);
								});
						};
						var queues = [	
							{ 
								name: util.format('client.%s.public', client.id), 
								routingKey: util.format('room.%s.broadcast.#', client.room),
								consume: consumeFunc
							},
							{ 
								name: util.format('client.%s.private', client.id), 
								routingKey: util.format('room.%s.client.%s.#', client.room, client.id),
								consume: consumeFunc
							}
						];
						
						queues = queues.map(function (options) { 
							log.debug('Creating queue %s for client %s with routingKey %s ...', 
								options.name, client.id, options.routingKey);
							return mq.addClientQueue(options); 
						});

						return Promise.all(queues);
				})
				.then(function () {
					log.debug('Finished client %s set up', client.id);

					return client;
				})
				.catch(function (err) {
					log.error('Error setting up client', err, err.stack);	
				});
			});

			log.debug('Binding events to monitor ...');
			monitor.on('shutdown', function () {
				var queue = util.format('monitor.%s', monitor.id);

				mq.removeServerQueue(queue);	
			});

			monitor.on('publish', function (room, route, msg) {
				var routingKey = util.format('room.%s.%s', room, route);
				
				// TODO: Utilize headers in publishing here?
				mq
					.publishServerExchange(routingKey, msg)
					.then(function () {
						log.debug('Published data from monitor to room %s route %s', 
							room, route, msg);	
					});	
			});

			log.debug('Creating monitor queues ...');
			var monitorQueue = mq.addServerQueue({ 
				name: util.format('monitor.%s', monitor.id), 
				routingKey: '#',
				consume: function (message, headers, deliveryInfo, messageObj) {
					if (message.data instanceof Buffer) {
						message = message.data.toString('utf8');
					}

					monitor.ingest(message, headers, deliveryInfo, messageObj);
				}
			});

			return monitorQueue;
		})
		.then(function () {
			log.info('Everything is good to go capt!');	

			return self;
		})
		.catch(function (err) {
			log.error('Error setting up components', err, err.stack);	
		});
};

module.exports = Framework;
