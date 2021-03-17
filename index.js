const usb = require('usb');

let device;
let deviceInterface;

let endpointIn;
let endpointOut;

let shuttingDown = false;
let firstRun = true;

let isClaimed = false;
let isOpen    = false;
let isPolling = false;

let intervalGetData;


const status = {
	fan1Speed : null,
	fan2Speed : null,
	fan3Speed : null,

	firmwareVersion : null,
	hardwareVersion : null,

	pumpMode  : null,
	pumpSpeed : null,

	setPumpMode : null,

	temperature : null,
};


function handleResponse(data) {
	let packetType;
	switch (data[0]) {
		case 0x31 : packetType = 'pumpSpeed';   break;
		case 0x32 : packetType = 'setPumpMode'; break;
		case 0x33 : packetType = 'pumpMode';    break;

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
		case 0x31 : packetValue = data.readInt16BE(3); break;

		case 0x32 : packetValue = Boolean(data[1] === 0x12 && data[2] === 0x34); break;

		case 0x33 :
			switch (data[3]) {
				case 0x00 : packetValue = 'quiet';       break;
				case 0x01 : packetValue = 'balanced';    break;
				case 0x02 : packetValue = 'performance'; break;
			}
			break;

		case 0x41 : packetValue = data.readInt16BE(4); break;

		case 0xA9 : packetValue = data[3] + (data[4] / 10); break;

		case 0xAA :	packetValue = data[3] + '.' + data[4] + '.' + data[5] + '.' + data[6]; break;

		case 0xAB :	packetValue = data[3]; break;

		default : packetValue = null;
	}

	const packet = { packetType, packetValue };
	console.log('hndlRes() :: data: %o', data);
	console.log('hndlRes() :: packet: %s', JSON.stringify(packet, null, 2));

	status[packetType] = packetValue;
}


async function getPumpMode() {
	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x33 ], resolve, reject));
	}
	catch (getPumpModeError) {
		console.log('getPumpMode() :: getPumpModeError');
		console.dir(getPumpModeError, { depth : null, showHidden : true });
		await term();
		process.exit(2);
	}
} // getPumpMode()


async function getInfo() {
	if (shuttingDown !== false) return;

	console.log('getInfo() :: begin');

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xAA ], resolve, reject));
	}
	catch (getInfoStep0Error) {
		console.log('getInfo() :: getInfoStep0Error');
		console.dir(getInfoStep0Error, { depth : null, showHidden : true });
		await term();
		process.exit(3);
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xAB ], resolve, reject));
	}
	catch (getInfoStep1Error) {
		console.log('getInfo() :: getInfoStep1Error');
		console.dir(getInfoStep1Error, { depth : null, showHidden : true });
		await term();
		process.exit(4);
	}

	return true;
} // getInfo()

async function getData() {
	if (firstRun === true) {
		firstRun = false;
	}
	else {
		await init();
	}

	if (shuttingDown !== false) return;

	// console.log('getData() :: begin');

	await getPumpMode();

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xA9 ], resolve, reject));
	}
	catch (getDataStep0Error) {
		console.log('getData() :: getDataStep0Error');
		console.dir(getDataStep0Error, { depth : null, showHidden : true });
		await term();
		process.exit(5);
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x41, 0x00 ], resolve, reject));
	}
	catch (getDataStep1Error) {
		console.log('getData() :: getDataStep1Error');
		console.dir(getDataStep1Error, { depth : null, showHidden : true });
		await term();
		process.exit(6);
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x41, 0x01 ], resolve, reject));
	}
	catch (getDataStep2Error) {
		console.log('getData() :: getDataStep2Error');
		console.dir(getDataStep2Error, { depth : null, showHidden : true });
		await term();
		process.exit(7);
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x41, 0x02 ], resolve, reject));
	}
	catch (getDataStep3Error) {
		console.log('getData() :: getDataStep3Error');
		console.dir(getDataStep3Error, { depth : null, showHidden : true });
		await term();
		process.exit(8);
	}

	try {
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x31 ], resolve, reject));
	}
	catch (getDataStep4Error) {
		console.log('getData() :: getDataStep4Error');
		console.dir(getDataStep4Error, { depth : null, showHidden : true });
		await term();
		process.exit(9);
	}

	console.log('getData() :: status: %s', JSON.stringify(status, null, 2));

	await updatePumpMode();

	await term();

	return true;
} // getData()


async function updatePumpMode() {
	if (typeof status.pumpMode !== 'string' || status.pumpMode === '' || status.pumpMode === null) {
		console.log('updatePumpMode() :: missing pumpMode');
		return;
	}

	if (typeof status.temperature !== 'number' || status.temperature === 0 || status.temperature === null) {
		console.log('updatePumpMode() :: missing temperature');
		return;
	}


	let pumpModeTarget = 'performance';
	if (status.temperature < 27) {
		pumpModeTarget = 'quiet';
	}
	else if (status.temperature < 29) {
		pumpModeTarget = 'balanced';
	}

	if (status.pumpMode === pumpModeTarget) return;

	console.log('updatePumpMode() :: pumpModeTarget = \'%s\'', pumpModeTarget);

	await setPumpMode(pumpModeTarget);
} // updatePumpMode()

async function setPumpMode(newPumpMode) {
	let newPumpModeId = 0x02;
	switch (newPumpMode) {
		case 'quiet'       : newPumpModeId = 0x00; break;
		case 'balanced'    : newPumpModeId = 0x01; break;
		case 'performance' : newPumpModeId = 0x02;
	}

	try {
		console.log('setPumpMode() :: setting pumpMode %s, pumpModeId %o', newPumpMode, newPumpModeId);
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x32, newPumpModeId ], resolve, reject));
		await getPumpMode();
	}
	catch (setPumpModeError) {
		console.log('setPumpMode() :: setPumpModeError');
		console.dir(setPumpModeError, { depth : null, showHidden : true });
		await term();
		process.exit(10);
	}
} // setPumpMode(newPumpMode)


// Configure term event listeners
async function termConfig() {
	process.once('SIGTERM', async () => {
		console.log('\nCaught SIGTERM');
		shuttingDown = true;
		clearInterval(intervalGetData);
		await term();
		process.exit(1);
	});

	process.once('SIGINT', async () => {
		console.log('\nCaught SIGINT');
		shuttingDown = true;
		clearInterval(intervalGetData);
		await term();
		process.exit(0);
	});

	process.once('exit', async () => {
		console.log('Caught exit event');
		clearInterval(intervalGetData);
		shuttingDown = true;
	});
} // term_config()

async function init() {
	if (firstRun === true) {
		await termConfig();

		device = await usb.findByIds(0x1B1C, 0x0C12);
	}

	if (isOpen === false) {
		try {
			console.log('init()    :: device open start');
			await device.open();
			console.log('init()    :: device open end');
		}
		catch (deviceOpenError) {
			console.log('init()    :: deviceOpenError');
			console.dir(deviceOpenError, { depth : null, showHidden : true });
			await term();
			process.exit(11);
		}

		console.log('init()    :: device open OK');
		isOpen = true;
	}

	deviceInterface = device.interfaces[0];


	if (isClaimed === false) {
		try {
			console.log('init()    :: deviceInterface claim start');
			await deviceInterface.claim();
			console.log('init()    :: deviceInterface claim end');
		}
		catch (deviceInterfaceClaimError) {
			console.log('init()    :: deviceInterfaceClaimError');
			console.dir(deviceInterfaceClaimError, { depth : null, showHidden : true });
			await term();
			process.exit(12);
		}

		console.log('init()    :: deviceInterface claim OK');
		isClaimed = true;
	}


	endpointIn  = deviceInterface.endpoints[0];
	endpointOut = deviceInterface.endpoints[1];

	endpointIn.on('data', handleResponse);

	endpointIn.on('error', async endpointInError => {
		console.log('dataIn()  :: endpointInError');
		console.dir(endpointInError, { depth : null, showHidden : true });
		await term();
		process.exit(13);
	});


	if (isPolling === false) {
		try {
			console.log('init()    :: endpointIn polling start begin');
			await endpointIn.startPoll();
			console.log('init()    :: endpointIn polling start end');
		}
		catch (endpointInStartPollError) {
			console.log('init()    :: endpointInStartPollError');
			console.dir(endpointInStartPollError, { depth : null, showHidden : true });
			await term();
			process.exit(14);
		}

		console.log('init()    :: endpointIn polling start OK');
		isPolling = true;
	}

	return true;
} // init()

async function term() {
	console.log('term()');

	endpointIn.removeAllListeners('data');
	endpointIn.removeAllListeners('error');

	if (isPolling === true) {
		try {
			console.log('term()    :: endpointIn polling stop begin');
			await new Promise(resolve => endpointIn.stopPoll(resolve));
			console.log('term()    :: endpointIn polling stop end');
		}
		catch (endpointInStopPollError) {
			console.log('term()    :: endpointInStopPollError');
			console.dir(endpointInStopPollError, { depth : null, showHidden : true });
			process.exit(15);
		}

		console.log('term()    :: endpointIn polling stop OK');
		isPolling = false;
	}


	if (isClaimed === true) {
		try {
			console.log('term()    :: deviceInterface release begin');
			await new Promise(resolve => deviceInterface.release(resolve));
			console.log('term()    :: deviceInterface release end');
		}
		catch (deviceInterfaceReleaseError) {
			console.log('term()    :: deviceInterfaceReleaseError');
			console.dir(deviceInterfaceReleaseError, { depth : null, showHidden : true });
			process.exit(15);
		}

		console.log('term()    :: deviceInterface release OK');
		isClaimed = false;
	}


	if (isOpen === true) {
		try {
			console.log('term()    :: device close begin');
			await device.close();
			console.log('term()    :: device close end');
		}
		catch (deviceCloseError) {
			console.log('term()    :: deviceCloseError');
			console.dir(deviceCloseError, { depth : null, showHidden : true });
			process.exit(16);
		}

		console.log('term()    :: device close OK\n');
		isOpen = false;
	}

	return true;
} // term()


(async () => {
	await init();
	await getInfo();
	await getData();

	// intervalGetData = setInterval(getData, 500);
})();
