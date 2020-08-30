const usb = require('usb');

let device;
let deviceInterface;

let endpointIn;
let endpointOut;

const status = {};


function handleResponse(data) {
	let packetType;
	switch (data[0]) {
		case 0x31 : packetType = 'pumpSpeed'; break;
		case 0x33 : packetType = 'pumpMode';  break;

		case 0x41 :
			switch (data[3]) {
				case 0x00 : packetType = 'fan1Speed'; break;
				case 0x01 : packetType = 'fan2Speed'; break;
				case 0x02 : packetType = 'fan3Speed'; break;
			}
			break;

		case 0xA9 : packetType = 'temperature';     break;
		case 0xAA : packetType = 'firmwareVersion'; break;
		case 0xAB : packetType = 'hardwareVersion'; break;

		default : packetType = 'unknown';
	}

	let packetValue;
	switch (data[0]) {
		case 0x31 :
			packetValue = data.readInt16BE(3);
			break;

		case 0x33 :
			switch (data[3]) {
				case 0x00 : packetValue = 'quiet';       break;
				case 0x01 : packetValue = 'balanced';    break;
				case 0x02 : packetValue = 'performance'; break;
			}
			break;

		case 0x41 :
			packetValue = data.readInt16BE(4);
			break;

		case 0xA9 :
			packetValue = data[3] + (data[4] / 10);
			break;

		case 0xAA :
			packetValue = data[3] + '.' + data[4] + '.' + data[5] + '.' + data[6];
			break;

		case 0xAB :
			packetValue = data[3];
			break;

		default : packetValue = null;
	}

	const packet = {
		packetType,
		packetValue,
	};

	// console.log('hndlRes() :: data: %o', data);
	// console.log('hndlRes() :: packet: %s', JSON.stringify(packet, null, 2));

	status[packetType] = packetValue;
}

async function init() {
	device = await usb.findByIds(0x1B1C, 0x0C12);

	try {
		console.log('init()    :: device open start');
		await device.open();
		console.log('init()    :: device open end');
	}
	catch (error) {
		console.log('init()    :: device open error');
		console.error(error);
		return error;
	}

	console.log('init()    :: device open OK');

	deviceInterface = device.interfaces[0];


	try {
		console.log('init()    :: deviceInterface claim start');
		await deviceInterface.claim();
		console.log('init()    :: deviceInterface claim end');
	}
	catch (error) {
		console.log('init()    :: endpointIn polling start error');
		console.error(error);
		return error;
	}

	console.log('init()    :: deviceInterface claim OK');


	endpointIn  = deviceInterface.endpoints[0];
	endpointOut = deviceInterface.endpoints[1];

	endpointIn.on('data', handleResponse);

	endpointIn.on('error', error => {
		console.log('dataIn()  :: error');
		console.error(error);
	});


	try {
		console.log('init()    :: endpointIn polling start begin');
		await endpointIn.startPoll();
		console.log('init()    :: endpointIn polling start end');
	}
	catch (error) {
		console.log('init()    :: endpointIn polling start error');
		console.error(error);
		return error;
	}

	console.log('init()    :: endpointIn polling start OK');

	return true;
}

async function getInfo() {
	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xAA ], resolve, reject));
	}
	catch (error) {
		console.log('getData() :: transfer 1 error');
		console.error(error);
		return error;
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xAB ], resolve, reject));
	}
	catch (error) {
		console.log('getData() :: transfer 2 error');
		console.error(error);
		return error;
	}

	return true;
}

async function getData() {
	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xA9 ], resolve, reject));
	}
	catch (error) {
		console.log('getData() :: transfer 3 error');
		console.error(error);
		return error;
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x41, 0x00 ], resolve, reject));
	}
	catch (error) {
		console.log('getData() :: transfer 4 error');
		console.error(error);
		return error;
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x41, 0x01 ], resolve, reject));
	}
	catch (error) {
		console.log('getData() :: transfer 5 error');
		console.error(error);
		return error;
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x41, 0x02 ], resolve, reject));
	}
	catch (error) {
		console.log('getData() :: transfer 6 error');
		console.error(error);
		return error;
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x33 ], resolve, reject));
	}
	catch (error) {
		console.log('getData() :: transfer 7 error');
		console.error(error);
		return error;
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x31 ], resolve, reject));
	}
	catch (error) {
		console.log('getData() :: transfer 8 error');
		console.error(error);
		return error;
	}

	console.log('getData() :: status: %s', JSON.stringify(status, null, 2));

	return true;
}

async function term() {
	try {
		console.log('term()    :: endpointIn polling stop begin');
		await new Promise(resolve => endpointIn.stopPoll(resolve));
		console.log('term()    :: endpointIn polling stop end');
	}
	catch (error) {
		console.log('term()    :: device close error');
		console.error(error);
		return error;
	}

	console.log('term()    :: endpointIn polling stop OK');


	try {
		console.log('term()    :: deviceInterface release begin');
		await new Promise(resolve => deviceInterface.release(resolve));
		console.log('term()    :: deviceInterface release end');
	}
	catch (error) {
		console.log('term()    :: deviceInterface release error');
		console.error(error);
		throw error;
	}

	console.log('term()    :: deviceInterface release OK');


	try {
		console.log('term()    :: device close begin');
		await device.close();
		console.log('term()    :: device close end');
	}
	catch (error) {
		console.log('term()    :: device close error');
		console.error(error);
		return error;
	}

	console.log('term()    :: device close OK\n');

	return true;
}


async function run() {
	await init();
	await getInfo();

	for (let i = 0; i <= 10; i++) {
		await getData();
		await new Promise(resolve => setTimeout(resolve, 500));
	}

	await term();
}


run();
