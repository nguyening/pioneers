var path = require('path');

var bunyan = require('bunyan');
var Promise = require('es6-promise').Promise;

var Framework = require('./lib/framework');
var Monitor = require('./src/server/monitor.js');
// var bodyParser = require('body-parser');
var express = require('express');

var HOST = '0.0.0.0';
var PORT = 3000;
var MQHOST = 'localhost';


var app = express();
var log = bunyan.createLogger({ name: 'pioneers', level: 'debug' });

log.info('Setting up Express middleware ...');
app.set('views', __dirname + '/views');
app.set('view engine', 'jade');
// app.use(bodyParser.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function (req, res) {
	res.render('index.jade', {title: 'Main page'});
});

var setupHTTP = new Promise(function (resolve, reject) {
	var httpServer = app.listen(PORT, HOST, function (err) {
		if (err) { reject(err); }

		resolve(httpServer);
	});

	log.info('Setting up web server listening on %s:%d ...', HOST, PORT);
});
var setupMonitor = Monitor.initialize();

Promise.all([setupHTTP, setupMonitor]).then(function (res) {
	var httpServer = res[0];
	var monitor = res[1];

	var engine = Framework(MQHOST);
	return engine.setup(httpServer, monitor);
})
.catch(function (err) {
	log.error('Error setting up application', err, err.stack);	
});
