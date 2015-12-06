var HOST = 'localhost';
var PORT = 3000;
var connect = function(room) {
	var webSocket = new WebSocket('ws://'+HOST+':'+PORT+'/'+room);
	webSocket.onopen = function() {
		$('#room-messages').append('<p>Opened websocket connection</p>');
	};

	webSocket.onmessage = function(e) {
		var msg = e.data;
		$('#room-messages').append('<p>Received message over Websocket connection:' + msg + '</p>');
	};

	webSocket.onclose = function() {
		$('#room-messages').append('<p>Closed websocket connection</p>');
	};

	return webSocket;
};


$(document).ready(function() {
	var params={};window.location.search.replace(/[?&]+([^=&]+)=([^&]*)/gi,function(str,key,value){params[key] = value;});

	if (params.room !== undefined) {
		var ws = connect(params.room);

		$('#send').click(function(evt) {
			evt.preventDefault();
			ws.send($('#payload').val());
		});
	}
});
