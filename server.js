var path = require('path');

var bunyan = require('bunyan'),
	bodyParser = require('body-parser'),
	express = require('express'),
	Promise = require('es6-promise').Promise,
	wss = require('ws').Server;

var HOST = '0.0.0.0';
var PORT = 3000;

var app = express(),
	log = bunyan.createLogger({ name: 'pioneers-server', level: 'debug' });

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
	});

exports.initialize = function() {
	return Promise.all([setupApp, setupServer, setupWSServer]);
};

