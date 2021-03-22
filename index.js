/* eslint-disable no-unused-vars */

const { Console } = require('console');

const consoleOptions = {
	stdout           : process.stdout,
	stderr           : process.stderr,
	ignoreErrors     : true,
	colorMode        : 'auto',
	groupIndentation : 0,

	inspectOptions : {
		breakLength     : Infinity,
		compact         : true,
		depth           : Infinity,
		maxArrayLength  : Infinity,
		maxStringLength : Infinity,
		showHidden      : false,
	},
};

const minLog = new Console(consoleOptions);


const usb = require('usb');

const SerialPort = require('serialport');
const Readline = require('@serialport/parser-readline');

const parser = new Readline({ delimiter : '\r\n' });

let port;


const globalDelay   = 50;
const globalTimeout = 500;


const deviceStatus = {
	claimed : false,
	open    : false,
	polling : false,
};

const status = {
	command : {
		setFanSpeedPwm : null,
		setFanSpeedRpm : null,

		setPumpMode : null,
	},

	fanController : {
		pidControl         : null,
		pwmDutyPct         : null,
		temperatureCurrent : null,
	},

	data : {
		fan0Speed : null,
		fan1Speed : null,
		fan2Speed : null,

		pumpMode  : null,
		pumpSpeed : null,

		temperature : 29,
	},

	somethingsBroken : {
		somethingsBroken : null,
	},

	version : {
		firmware : null,
		hardware : null,
	},
};


let device;
let deviceInterface;

let endpointIn;
let endpointOut;

let intervalGetData;

let shuttingDown = false;


function updateControllerTemp(temperatureValue) {
	port.write('#tmp' + temperatureValue + '\n');
} // updateControllerTemp(temperatureValue)

function parseControllerData(data) {
	try {
		const parsedData = JSON.parse(data);

		status.fanController = parsedData;
		status.fanController.pidControl = Boolean(status.fanController.pidControl);

		// console.log('parseControllerData() :: parsedData', parsedData);

		setFanSpeedPwm(0, status.fanController.pwmDutyPct);
		setFanSpeedPwm(1, status.fanController.pwmDutyPct);
		setFanSpeedPwm(2, status.fanController.pwmDutyPct);
	}
	// eslint-disable-next-line no-empty
	catch (e) {}
} // parseControllerData(data);


async function getFirmwareVersion() {
	try {
		// console.log('getFirmwareVersion()  :: getFirmwareVersionStep0');
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xAA ], resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (getFirmwareVersionStep0Error) {
		console.log('getFirmwareVersion()  :: getFirmwareVersionStep0Error');
		console.dir(getFirmwareVersionStep0Error, { depth : null, showHidden : true });
		await term();
		process.exit(2);
	}
} // async getFirmwareVersion()

async function getHardwareVersion() {
	try {
		// console.log('getHardwareVersion()  :: getHardwareVersionStep0');
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xAB ], resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (getHardwareVersionStep0Error) {
		console.log('getHardwareVersion()  :: getHardwareVersionStep0Error');
		console.dir(getHardwareVersionStep0Error, { depth : null, showHidden : true });
		await term();
		process.exit(2);
	}
} // async getHardwareVersion()


async function getTemperature() {
	try {
		// console.log('getTemperature()      :: getTemperature');
		await new Promise((resolve, reject) => endpointOut.transfer([ 0xA9 ], resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (getTemperatureError) {
		console.log('getTemperature()      :: getTemperatureError');
		console.dir(getTemperatureError, { depth : null, showHidden : true });
		await term();
		process.exit(2);
	}
} // async getTemperature()


async function getFanSpeed(fanId) {
	try {
		// console.log('getFanSpeed(%o)        :: getFanSpeed', fanId);
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x41, fanId ], resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (getFanSpeedError) {
		console.log('getFanSpeed(%o)        :: getFanSpeedError', fanId);
		console.dir(getFanSpeedError, { depth : null, showHidden : true });
		await term(2);
	}
} // async getFanSpeed()

async function setFanSpeedPwm(fanId, pwmValue) {
	try {
		// console.log('setFanSpeedPwm(%o)        :: setFanSpeedPwm', fanId);
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x42, fanId, pwmValue ], resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (setFanSpeedPwmError) {
		console.log('setFanSpeedPwm(%o)        :: setFanSpeedPwmError', fanId);
		console.dir(setFanSpeedPwmError, { depth : null, showHidden : true });
		await term(2);
	}
} // async setFanSpeedPwm()

async function setFanSpeedRpm(fanId, rpmValue) {
	try {
		// console.log('setFanSpeedRpm(%o)        :: setFanSpeedRpm', fanId);
		const transferBuffer = Buffer.alloc(4);
		transferBuffer.writeUInt8(0x43, 0);
		transferBuffer.writeUInt8(fanId, 1);
		transferBuffer.writeUint16BE(rpmValue, 2);

		await new Promise((resolve, reject) => endpointOut.transfer(transferBuffer, resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (setFanSpeedRpmError) {
		console.log('setFanSpeedRpm(%o)        :: setFanSpeedRpmError', fanId);
		console.dir(setFanSpeedRpmError, { depth : null, showHidden : true });
		await term(2);
	}
} // async setFanSpeedRpm()


async function setFanSpeedCustomCurve(fanId, tempValues, pwmValues) {
	try {
		// console.log('setFanSpeedCustomCurve(%o)        :: setFanSpeedCustomCurve %o %o', fanId, tempValues, pwmValues);
		const transferBuffer = Buffer.from([ 0x40, fanId, ...tempValues, ...pwmValues ]);

		await new Promise((resolve, reject) => endpointOut.transfer(transferBuffer, resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (setFanSpeedCustomCurveError) {
		console.log('setFanSpeedCustomCurve(%o)        :: setFanSpeedCustomCurveError', fanId);
		console.dir(setFanSpeedCustomCurveError, { depth : null, showHidden : true });
		await term(2);
	}
} // async setFanSpeedCustomCurve()


async function getPumpMode() {
	try {
		// console.log('getPumpMode()         :: getPumpModeStep0');
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x33 ], resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (getPumpModeStep0Error) {
		console.log('getPumpMode()         :: getPumpModeStep0Error');
		console.dir(getPumpModeStep0Error, { depth : null, showHidden : true });
		await term();
		process.exit(2);
	}
} // async getPumpMode()

async function getPumpSpeed() {
	try {
		// console.log('getPumpSpeed()        :: getPumpSpeed');
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x31 ], resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (getPumpSpeedError) {
		console.log('getPumpSpeed()        :: getPumpSpeedError');
		console.dir(getPumpSpeedError, { depth : null, showHidden : true });
		await term();
		process.exit(2);
	}
} // async getPumpSpeed()

async function setPumpMode(newPumpMode) {
	let newPumpModeId;
	switch (newPumpMode) {
		case 'quiet'       : newPumpModeId = 0x00; break;
		case 'balanced'    : newPumpModeId = 0x01; break;
		case 'performance' : newPumpModeId = 0x02; break;

		default : newPumpModeId = 0x02; // performance by default
	}

	try {
		console.log('setPumpMode()         :: setting pumpMode %o, pumpModeId %o', newPumpMode, newPumpModeId);
		await new Promise((resolve, reject) => endpointOut.transfer([ 0x32, newPumpModeId ], resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
		await getPumpMode();
	}
	catch (setPumpModeError) {
		console.log('setPumpMode()         :: setPumpModeError');
		console.dir(setPumpModeError, { depth : null, showHidden : true });
		await term(10);
	}
} // async setPumpMode(newPumpMode)

function updatePumpMode() {
	if (typeof status.data.pumpMode !== 'string' || status.data.pumpMode === '' || status.data.pumpMode === null) {
		console.log('updatePumpMode()      :: missing pumpMode');
		return;
	}

	if (typeof status.data.temperature !== 'number' || status.data.temperature === 0 || status.data.temperature === null) {
		console.log('updatePumpMode()      :: missing temperature');
		return;
	}

	const cTemp = status.data.temperature;

	let pumpModeTarget = status.data.pumpMode;
	switch (status.data.pumpMode) {
		case 'quiet' : {
			if (cTemp >= 29) pumpModeTarget = 'balanced';
			break;
		}

		case 'balanced' : {
			if (cTemp <= 28) pumpModeTarget = 'quiet';
			if (cTemp >= 30) pumpModeTarget = 'performance';
			break;
		}

		case 'performance' : {
			if (cTemp <= 29) pumpModeTarget = 'balanced';
			break;
		}

		default : pumpModeTarget = 'performance';
	}

	if (status.data.pumpMode === pumpModeTarget) {
		// console.log('updatePumpMode()      :: correct mode %o already set', pumpModeTarget);
		return;
	}

	console.log('updatePumpMode()      :: pumpModeTarget = %o', pumpModeTarget);

	setPumpMode(pumpModeTarget);
} // updatePumpMode()


async function getInfo() {
	if (shuttingDown !== false) return;

	// console.log('getInfo()             :: begin');

	await getFirmwareVersion();
	await getHardwareVersion();

	return true;
} // async getInfo()

async function getData() {
	if (shuttingDown !== false) return;

	// console.log('getData()             :: begin');

	await getFanSpeed(0);
	await getFanSpeed(1);
	await getFanSpeed(2);

	await getPumpMode();
	await getPumpSpeed();

	await getTemperature();

	const statusObj = {
		temp    : status.data.temperature,
		fans    : [ status.data.fan0Speed, status.data.fan1Speed, status.data.fan2Speed ],
		pump    : [ status.data.pumpMode, status.data.pumpSpeed ],
		fanCtrl : {
			temp : status.fanController.temperatureCurrent,
			duty : status.fanController.pwmDutyPct,
		},
	};

	minLog.log(statusObj);
	// console.log('getData()             :: status: %o', status);

	updatePumpMode();

	return true;
} // async getData()


function handleResponse(data) {
	// console.log('handleResponse()      :: data: %o', data);

	let packetClass;
	switch (data[0]) {
		case 0x31 :
		case 0x33 :
		case 0x41 :
		case 0xA9 : {
			packetClass = 'data';
			break;
		}

		case 0x32 :
		case 0x42 :
		case 0x43 : {
			packetClass = 'command';
			break;
		}

		case 0x8F : {
			packetClass = 'somethingsBroken';
			break;
		}

		case 0xAA :
		case 0xAB : {
			packetClass = 'version';
			break;
		}

		default : packetClass = 'unknown';
	}


	let packetType;
	switch (data[0]) {
		case 0x31 : packetType = 'pumpSpeed'; break;
		case 0x33 : packetType = 'pumpMode';  break;

		case 0x41 :	packetType = 'fan' + data[3].toString() + 'Speed'; break;

		case 0x32 : packetType = 'setPumpMode';    break;
		case 0x42 : packetType = 'setFanSpeedPwm'; break;
		case 0x43 : packetType = 'setFanSpeedRpm'; break;

		case 0x8F : packetType = 'somethingsBroken'; break;

		case 0xA9 : packetType = 'temperature'; break;

		case 0xAA : packetType = 'firmware'; break;
		case 0xAB : packetType = 'hardware'; break;

		default : packetType = 'unknown';
	}


	let packetValue;
	switch (data[0]) {
		case 0x31 : packetValue = data.readInt16BE(3); break;

		case 0x33 :
			switch (data[3]) {
				case 0x00 : packetValue = 'quiet';       break;
				case 0x01 : packetValue = 'balanced';    break;
				case 0x02 : packetValue = 'performance'; break;
			}
			break;

		case 0x41 : packetValue = data.readInt16BE(4); break;

		case 0x32 :
		case 0x42 :
		case 0x43 : packetValue = Boolean(data[1] === 0x12 && data[2] === 0x34); break;

		case 0x8F : packetValue = data; break;

		case 0xA9 : packetValue = data[3] + (data[4] / 10); break;

		case 0xAA :	packetValue = data[3] + '.' + data[4] + '.' + data[5] + '.' + data[6]; break;
		case 0xAB :	packetValue = data[3]; break;

		default : packetValue = null;
	}


	switch (packetType) {
		case 'temperature' : {
			updateControllerTemp(packetValue);
			break;
		}

		case 'somethingsBroken' : {
			const packet = { packetClass, packetType, packetValue };
			console.log('handleResponse()      :: packet: %o', packet);
			break;
		}
	}


	status[packetClass][packetType] = packetValue;
} // handleResponse(data)

async function init() {
	device = await usb.findByIds(0x1B1C, 0x0C12);

	if (deviceStatus.open === false) {
		try {
			// console.log('init()                :: device open start');
			await device.open();
			// console.log('init()                :: device open end');
		}
		catch (deviceOpenError) {
			console.log('init()                :: deviceOpenError');
			console.dir(deviceOpenError, { depth : null, showHidden : true });
			await term();
			process.exit(11);
		}

		console.log('init()                :: device open OK');
		deviceStatus.open = true;
	}


	// Set the software clear-to-send flow control policy for device
	// https://github.com/liquidctl/liquidctl/blob/c38387063b986f21820c7ea695b63265577594ff/liquidctl/driver/asetek.py#L84
	try {
		const bmRequestType = usb.LIBUSB_ENDPOINT_OUT | usb.LIBUSB_REQUEST_TYPE_VENDOR | usb.LIBUSB_RECIPIENT_DEVICE;
		const bRequest      = 0x02;
		const wValue        = 0x00;
		const wIndex        = 0x00;

		// const ctrlTransferData = Buffer.from([ 0x02 ]);
		const ctrlTransferData = Buffer.alloc(0);

		// console.log('init()                :: device controlTransfer start');
		await new Promise((resolve, reject) => device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, ctrlTransferData, resolve, reject));
		// console.log('init()                :: device controlTransfer end');
	}
	catch (deviceControlTransferError) {
		console.log('init()                :: deviceControlTransferError');
		console.dir(deviceControlTransferError, { depth : null, showHidden : true });
		await term();
		process.exit(12);
	}

	console.log('init()                :: device controlTransfer OK');


	try {
		// console.log('init()                :: device reset start');
		await new Promise((resolve, reject) => device.reset(resolve, reject));
		// console.log('init()                :: device reset end');
	}
	catch (deviceResetError) {
		console.log('init()                :: deviceResetError');
		console.dir(deviceResetError, { depth : null, showHidden : true });
		await term();
		process.exit(12);
	}

	console.log('init()                :: device reset OK');


	deviceInterface = device.interface(0);


	if (deviceStatus.claimed === false) {
		try {
			// console.log('init()                :: deviceInterface claim start');
			await deviceInterface.claim();
			// console.log('init()                :: deviceInterface claim end');
		}
		catch (deviceInterfaceClaimError) {
			console.log('init()                :: deviceInterfaceClaimError');
			console.dir({ deviceStatus });
			console.dir(deviceInterfaceClaimError, { depth : null, showHidden : true });
			await term();
			process.exit(12);
		}

		console.log('init()                :: deviceInterface claim OK');
		deviceStatus.claimed = true;
	}


	endpointIn  = deviceInterface.endpoints[0];
	endpointOut = deviceInterface.endpoints[1];


	// Set endpoint transfer timeout
	endpointIn.timeout  = globalTimeout;
	endpointOut.timeout = globalTimeout;


	try {
		// console.log('init()                :: endpointIn clearHalt start');
		await new Promise((resolve, reject) => endpointIn.clearHalt(resolve, reject));
		// console.log('init()                :: endpointIn clearHalt end');
	}
	catch (endpointInClearHaltError) {
		console.log('init()                :: endpointInClearHaltError');
		console.dir(endpointInClearHaltError, { depth : null, showHidden : true });
		await term();
		process.exit(12);
	}

	console.log('init()                :: endpointIn clearHalt OK');


	try {
		// console.log('init()                :: endpointOut clearHalt start');
		await new Promise((resolve, reject) => endpointOut.clearHalt(resolve, reject));
		// console.log('init()                :: endpointOut clearHalt end');
	}
	catch (endpointOutClearHaltError) {
		console.log('init()                :: endpointOutClearHaltError');
		console.dir(endpointOutClearHaltError, { depth : null, showHidden : true });
		await term();
		process.exit(12);
	}

	console.log('init()                :: endpointOut clearHalt OK');


	// Configure endpoint event listeners
	endpointIn.on('data', handleResponse);

	endpointIn.on('error', async endpointInError => {
		console.log('dataIn()              :: endpointInError');
		console.dir(endpointInError, { depth : null, showHidden : true });
		await term();
		process.exit(13);
	});

	endpointOut.on('error', async endpointOutError => {
		console.log('dataOut()              :: endpointOutError');
		console.dir(endpointOutError, { depth : null, showHidden : true });
		await term();
		process.exit(13);
	});


	if (deviceStatus.polling === false) {
		try {
			// console.log('init()                :: endpointIn polling start begin');
			await endpointIn.startPoll(1, 10);
			// console.log('init()                :: endpointIn polling start end');
		}
		catch (endpointInStartPollError) {
			console.log('init()                :: endpointInStartPollError');
			console.dir(endpointInStartPollError, { depth : null, showHidden : true });
			await term();
			process.exit(14);
		}

		console.log('init()                :: endpointIn polling start OK');
		deviceStatus.polling = true;
	}

	try {
		port = new SerialPort('/dev/tty.usbmodem14A201', { baudRate : 115200 });
		port.pipe(parser);
		parser.on('data', parseControllerData);
	}
	catch (err) {
		console.error(err);
	}

	return true;
} // async init()

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
} // async term_config()

async function term(exitCode = 0) {
	// Wait for globalTimeout ms for any last bytes to come through
	await new Promise(resolve => setTimeout(resolve, globalTimeout));

	if (typeof endpointIn !== 'undefined') {
		endpointIn.removeAllListeners('data');
		endpointIn.removeAllListeners('error');
	}

	if (typeof endpointOut !== 'undefined') {
		endpointOut.removeAllListeners('error');
	}

	if (deviceStatus.polling === true) {
		try {
			// console.log('term()                :: endpointIn polling stop begin');
			await new Promise(resolve => endpointIn.stopPoll(resolve));
			// console.log('term()                :: endpointIn polling stop end');
		}
		catch (endpointInStopPollError) {
			console.log('term()                :: endpointInStopPollError');
			console.dir({ deviceStatus });
			console.dir(endpointInStopPollError, { depth : null, showHidden : true });
			process.exit(15);
		}

		console.log('term()                :: endpointIn polling stop OK');
		deviceStatus.polling = false;
	}


	if (deviceStatus.claimed === true) {
		try {
			// console.log('term()                :: deviceInterface release begin');
			await new Promise(resolve => deviceInterface.release(true, resolve));
			// console.log('term()                :: deviceInterface release end');
		}
		catch (deviceInterfaceReleaseError) {
			console.log('term()                :: deviceInterfaceReleaseError');
			console.dir({ deviceStatus });
			console.dir(deviceInterfaceReleaseError, { depth : null, showHidden : true });
			process.exit(15);
		}

		console.log('term()                :: deviceInterface release OK');
		deviceStatus.claimed = false;
	}


	if (deviceStatus.open === true) {
		try {
			// console.log('term()                :: device close begin');
			await device.close();
			// console.log('term()                :: device close end');
		}
		catch (deviceCloseError) {
			console.log('term()                :: deviceCloseError');
			console.dir({ deviceStatus });
			console.dir(deviceCloseError, { depth : null, showHidden : true });
			process.exit(16);
		}

		console.log('term()                :: device close OK\n');
		deviceStatus.open = false;
	}

	process.exit(exitCode);
} // async term()


(async () => {
	await termConfig();
	await init();

	// await setFanSpeedRpm(0, 700);
	// await setFanSpeedRpm(1, 700);
	// await setFanSpeedRpm(2, 700);

	await getData();
	await getInfo();

	intervalGetData = setInterval(getData, 2000);
	// await term();
})();
