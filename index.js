/* eslint-disable no-unused-vars */

const refreshInterval   = 2000;
const temperatureTarget = 32;

const fanControllerSerial = '55739323930351F042C1';


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
const bindings   = require('@serialport/bindings');
const Readline   = require('@serialport/parser-readline');

const parser = new Readline({ delimiter : '\r\n' });

let port;


const globalDelay   = 50;
const globalTimeout = 500;


const status = {
	command : {
		setFanSpeedPwm : null,
		setFanSpeedRpm : null,

		setPumpMode : null,
	},

	device : {
		claimed : false,
		open    : false,
		polling : false,
	},

	fanController : {
		pidControl         : 1,
		pwmDutyPct         : 0,
		temperatureCurrent : temperatureTarget,
	},

	data : {
		fan0Speed : null,
		fan1Speed : null,
		fan2Speed : null,

		pumpMode  : null,
		pumpSpeed : null,

		temperature : temperatureTarget,
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


function logFmt(funcName, varName, obj) {
	funcName = (funcName + '()').padEnd(21);

	if (obj !== undefined) {
		minLog.log('%s :: %s', funcName, varName, obj);
		return;
	}

	minLog.log('%s :: %s', funcName, varName);
}

function logAll(data) {
	console.dir(data, { depth : null, showHidden : true });
}


async function getPortPath() {
	try {
		let portPath = null;

		const ports = await bindings.list();

		for (const port of ports) {
			if (port.serialNumber !== fanControllerSerial) continue;

			portPath = port.path;

			return portPath;
		}
	}
	catch (bindingsListError) {
		logFmt('bindingsList', 'bindingsListError');
		logAll(bindingsListError);
		await term(1);
	}
}


function updateControllerTemp(temperatureValue) {
	port.write('#tmp' + temperatureValue + '\n');
} // updateControllerTemp(temperatureValue)

function parseControllerData(data) {
	try {
		const parsedData = JSON.parse(data);

		status.fanController = parsedData;
		status.fanController.pidControl = Boolean(status.fanController.pidControl);

		// logFmt('parseControllerData', 'parsedData', parsedData);

		setFanSpeedPwm(0, status.fanController.pwmDutyPct);
		setFanSpeedPwm(1, status.fanController.pwmDutyPct);
		setFanSpeedPwm(2, status.fanController.pwmDutyPct);
	}
	// eslint-disable-next-line no-empty
	catch (e) {}
} // parseControllerData(data);


async function getFirmwareVersion() {
	try {
		// logFmt('getFirmwareVersion', 'getFirmwareVersionStep0');
		await send([ 0xAA ]);
	}
	catch (getFirmwareVersionStep0Error) {
		logFmt('getFirmwareVersion', 'getFirmwareVersionStep0Error');
		logAll(getFirmwareVersionStep0Error);
		await term(2);
	}
} // async getFirmwareVersion()

async function getHardwareVersion() {
	try {
		// logFmt('getHardwareVersion', 'getHardwareVersionStep0');
		await send([ 0xAB ]);
	}
	catch (getHardwareVersionStep0Error) {
		logFmt('getHardwareVersion', 'getHardwareVersionStep0Error');
		logAll(getHardwareVersionStep0Error);
		await term(3);
	}
} // async getHardwareVersion()


async function getTemperature() {
	try {
		// logFmt('getTemperature', 'getTemperature');
		await send([ 0xA9 ]);
	}
	catch (getTemperatureError) {
		logFmt('getTemperature', 'getTemperatureError');
		logAll(getTemperatureError);
		await term(4);
	}
} // async getTemperature()


async function getFanSpeed(fanId) {
	if (typeof fanId !== 'number') return;

	try {
		// logFmt('getFanSpeed', 'fanId', fanId);
		await send([ 0x41, fanId ]);
	}
	catch (getFanSpeedError) {
		logFmt('getFanSpeed(%o) :: getFanSpeedError', fanId);
		logAll(getFanSpeedError);
		await term(2);
	}
} // async getFanSpeed()

async function setFanSpeedPwm(fanId, pwmValue) {
	if (typeof fanId    !== 'number') return;
	if (typeof pwmValue !== 'number') return;

	if (pwmValue < 0)   pwmValue = 0;
	if (pwmValue > 100) pwmValue = 100;

	try {
		// logFmt('setFanSpeedPwm', 'args', { fanId, pwmValue });
		await send([ 0x42, fanId, pwmValue ]);
	}
	catch (setFanSpeedPwmError) {
		logFmt('setFanSpeedPwm(%o) :: setFanSpeedPwmError', fanId);
		logAll(setFanSpeedPwmError);
		await term(2);
	}
} // async setFanSpeedPwm()

async function setFanSpeedRpm(fanId, rpmValue) {
	if (typeof fanId    !== 'number') return;
	if (typeof rpmValue !== 'number') return;

	if (rpmValue < 0)    rpmValue = 0;
	if (rpmValue > 1600) rpmValue = 1600;

	try {
		// logFmt('setFanSpeedRpm', 'args', { fanId, rpmValue });
		const transferBuffer = Buffer.alloc(4);
		transferBuffer.writeUInt8(0x43, 0);
		transferBuffer.writeUInt8(fanId, 1);
		transferBuffer.writeUint16BE(rpmValue, 2);

		await send(transferBuffer);
	}
	catch (setFanSpeedRpmError) {
		logFmt('setFanSpeedRpm', 'error, fanId', fanId);
		logAll(setFanSpeedRpmError);
		await term(2);
	}
} // async setFanSpeedRpm()


async function setFanSpeedCustomCurve(fanId, tempValues, pwmValues) {
	try {
		// logFmt('setFanSpeedCustomCurve', 'args', { fanId, tempValues, pwmValues });
		const transferBuffer = Buffer.from([ 0x40, fanId, ...tempValues, ...pwmValues ]);

		await send(transferBuffer);
	}
	catch (setFanSpeedCustomCurveError) {
		logFmt('setFanSpeedCustomCurve', 'setFanSpeedCustomCurveError, fanId', fanId);
		logAll(setFanSpeedCustomCurveError);
		await term(2);
	}
} // async setFanSpeedCustomCurve()


async function getPumpMode() {
	try {
		// logFmt('getPumpMode', 'getPumpModeStep0');
		await send([ 0x33 ]);
	}
	catch (getPumpModeStep0Error) {
		logFmt('getPumpMode', 'getPumpModeStep0Error');
		logAll(getPumpModeStep0Error);
		await term(5);
	}
} // async getPumpMode()

async function getPumpSpeed() {
	try {
		// logFmt('getPumpSpeed', 'getPumpSpeed');
		await send([ 0x31 ]);
	}
	catch (getPumpSpeedError) {
		logFmt('getPumpSpeed', 'getPumpSpeedError');
		logAll(getPumpSpeedError);
		await term(6);
	}
} // async getPumpSpeed()

async function setPumpMode(pumpMode) {
	// logFmt('setPumpMode', 'pumpMode', pumpMode);

	let newPumpMode;
	switch (parseInt(pumpMode)) {
		case 0 : newPumpMode = 0x00; break;
		case 1 : newPumpMode = 0x01; break;
		case 2 : newPumpMode = 0x02; break;

		default : newPumpMode = 0x02; // 2 by default
	}

	try {
		logFmt('setPumpMode', 'newPumpMode', newPumpMode);
		await send([ 0x32, newPumpMode ]);
		await getPumpMode();
	}
	catch (setPumpModeError) {
		logFmt('setPumpMode', 'setPumpModeError');
		logAll(setPumpModeError);
		await term(10);
	}
} // async setPumpMode(pumpMode)

function updatePumpMode() {
	const cPump = status.data.pumpMode;
	const cTemp = status.data.temperature;

	if (typeof cPump !== 'number' || cPump === null) {
		logFmt('updatePumpMode', 'missing pumpMode');
		return;
	}

	if (typeof cTemp !== 'number' || cTemp === 0 || cTemp === null) {
		logFmt('updatePumpMode', 'missing temperature');
		return;
	}

	// Determine based on coolant temperature vs target temperature
	let pumpModeTarget = cPump;
	switch (cPump) {
		case 0 : {
			if (cTemp >= (temperatureTarget + 0.5)) pumpModeTarget = 1;
			break;
		}

		case 1 : {
			if (cTemp <= (temperatureTarget - 0.5)) pumpModeTarget = 0;
			if (cTemp >= (temperatureTarget + 1.5)) pumpModeTarget = 2;
			break;
		}

		case 2 : {
			if (cTemp <= (temperatureTarget + 0.5)) pumpModeTarget = 1;
			break;
		}

		default : pumpModeTarget = 2;
	}

	// Determine based on fan duty cycle
	if (status.fanController.pwmDutyPct >= 4) {
		pumpModeTarget = 1;
	}

	if (status.fanController.pwmDutyPct >= 20) {
		pumpModeTarget = 2;
	}


	if (cPump === pumpModeTarget) {
		// logFmt('updatePumpMode', 'correct mode already set', pumpModeTarget);
		return;
	}

	logFmt('updatePumpMode', 'pumpModeTarget', pumpModeTarget);

	setPumpMode(pumpModeTarget);
} // updatePumpMode()


async function send(data) {
	if (shuttingDown !== false) return;

	try {
		// logFmt('send', 'data', data);
		await new Promise((resolve, reject) => endpointOut.transfer(data, resolve, reject));
		await new Promise(resolve => setTimeout(resolve, globalDelay));
	}
	catch (sendError) {
		logFmt('send', 'sendError');
		logAll(sendError);
	}
} // async send(data)

async function getInfo() {
	if (shuttingDown !== false) return;

	// logFmt('getInfo', 'begin');

	await getFirmwareVersion();
	await getHardwareVersion();

	return true;
} // async getInfo()

async function getData() {
	if (shuttingDown !== false) return;

	// logFmt('getData', 'begin');

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

	logFmt('getData', 'status', statusObj);

	updatePumpMode();
} // async getData()


function handleResponse(data) {
	// logFmt('handleResponse', 'data', data);

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

		case 0x33 : packetValue = data[3]; break;

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
			logFmt('handleResponse', 'packet', packet);
			break;
		}
	}


	status[packetClass][packetType] = packetValue;
} // handleResponse(data)

async function init() {
	device = await usb.findByIds(0x1B1C, 0x0C12);

	if (status.device.open === false) {
		try {
			// logFmt('init() :: device open start');
			await device.open();
			// logFmt('init() :: device open', 'end');
		}
		catch (deviceOpenError) {
			logFmt('init() :: deviceOpenError');
			logAll(deviceOpenError);
			await term(7);
		}

		logFmt('init', 'device open', 'OK');
		status.device.open = true;
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

		// logFmt('init', 'device controlTransfer start');
		await new Promise((resolve, reject) => device.controlTransfer(bmRequestType, bRequest, wValue, wIndex, ctrlTransferData, resolve, reject));
		// logFmt('init', 'device controlTransfer', 'end');
	}
	catch (deviceControlTransferError) {
		logFmt('init', 'deviceControlTransferError');
		logAll(deviceControlTransferError);
		await term(8);
	}

	logFmt('init', 'device controlTransfer', 'OK');


	try {
		// logFmt('init', 'device reset start');
		await new Promise((resolve, reject) => device.reset(resolve, reject));
		// logFmt('init', 'device reset', 'end');
	}
	catch (deviceResetError) {
		logFmt('init', 'deviceResetError');
		logAll(deviceResetError);
		await term(9);
	}

	logFmt('init', 'device reset', 'OK');


	deviceInterface = device.interface(0);


	if (status.device.claimed === false) {
		try {
			// logFmt('init', 'deviceInterface claim start');
			await deviceInterface.claim();
			// logFmt('init', 'deviceInterface claim', 'end');
		}
		catch (deviceInterfaceClaimError) {
			logFmt('init', 'deviceInterfaceClaimError');
			logAll(deviceInterfaceClaimError);
			await term(10);
		}

		logFmt('init', 'deviceInterface claim', 'OK');
		status.device.claimed = true;
	}


	endpointIn  = deviceInterface.endpoints[0];
	endpointOut = deviceInterface.endpoints[1];


	// Set endpoint transfer timeout
	endpointIn.timeout  = globalTimeout;
	endpointOut.timeout = globalTimeout;


	try {
		// logFmt('init', 'endpointIn clearHalt start');
		await new Promise((resolve, reject) => endpointIn.clearHalt(resolve, reject));
		// logFmt('init', 'endpointIn clearHalt', 'end');
	}
	catch (endpointInClearHaltError) {
		logFmt('init', 'endpointInClearHaltError');
		logAll(endpointInClearHaltError);
		await term(11);
	}

	logFmt('init', 'endpointIn clearHalt', 'OK');


	try {
		// logFmt('init', 'endpointOut clearHalt start');
		await new Promise((resolve, reject) => endpointOut.clearHalt(resolve, reject));
		// logFmt('init', 'endpointOut clearHalt', 'end');
	}
	catch (endpointOutClearHaltError) {
		logFmt('init', 'endpointOutClearHaltError');
		logAll(endpointOutClearHaltError);
		await term(12);
	}

	logFmt('init', 'endpointOut clearHalt', 'OK');


	// Configure endpoint event listeners
	endpointIn.on('data', handleResponse);

	endpointIn.on('error', async endpointInError => {
		logFmt('endpointIn.onError', 'endpointOutError');
		logAll(endpointInError);
		await term(13);
	});

	endpointOut.on('error', async endpointOutError => {
		logFmt('endpointOut.onError', 'endpointOutError');
		logAll(endpointOutError);
		await term(14);
	});


	if (status.device.polling === false) {
		try {
			// logFmt('init', 'endpointIn polling start', 'begin');
			await endpointIn.startPoll(1, 10);
			// logFmt('init', 'endpointIn polling start', 'end');
		}
		catch (endpointInStartPollError) {
			logFmt('init', 'endpointInStartPollError');
			logAll(endpointInStartPollError);
			await term(15);
		}

		logFmt('init', 'endpointIn polling start', 'OK');
		status.device.polling = true;
	}

	try {
		const portPath = await getPortPath();
		port = new SerialPort(portPath, { baudRate : 115200 });
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
		console.log('');
		logFmt('Caught', 'SIGTERM');
		await term(16);
	});

	process.once('SIGINT', async () => {
		console.log('');
		logFmt('Caught', 'SIGINT');
		await term(0);
	});

	process.once('exit', async () => {
		logFmt('Caught', 'exit event');
	});
} // async term_config()

async function term(exitCode = 0) {
	shuttingDown = true;

	clearInterval(intervalGetData);

	// Wait for globalTimeout ms for any last bytes to come through
	await new Promise(resolve => setTimeout(resolve, globalTimeout));

	if (typeof endpointIn !== 'undefined') {
		endpointIn.removeAllListeners('data');
		endpointIn.removeAllListeners('error');
	}

	if (typeof endpointOut !== 'undefined') {
		endpointOut.removeAllListeners('error');
	}

	if (status.device.polling === true) {
		try {
			// logFmt('term', 'endpointIn polling stop', 'begin');
			await new Promise(resolve => endpointIn.stopPoll(resolve));
			// logFmt('term', 'endpointIn polling stop', 'end');
			logFmt('term', 'endpointIn polling stop', 'OK');
		}
		catch (endpointInStopPollError) {
			logFmt('term', 'endpointInStopPollError');
			logAll(endpointInStopPollError);
		}

		status.device.polling = false;
	}


	if (status.device.claimed === true) {
		try {
			// logFmt('term', 'deviceInterface release', 'begin');
			await new Promise(resolve => deviceInterface.release(true, resolve));
			// logFmt('term', 'deviceInterface release', 'end');
			logFmt('term', 'deviceInterface release', 'OK');
		}
		catch (deviceInterfaceReleaseError) {
			logFmt('term', 'deviceInterfaceReleaseError');
			logAll(deviceInterfaceReleaseError);
		}

		status.device.claimed = false;
	}


	if (status.device.open === true) {
		try {
			// logFmt('term', 'device close', 'begin');
			await device.close();
			// logFmt('term', 'device close', 'end');
			logFmt('term', 'device close', 'OK');
		}
		catch (deviceCloseError) {
			logFmt('term', 'deviceCloseError');
			logAll(deviceCloseError);
		}

		status.device.open = false;
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

	intervalGetData = setInterval(getData, refreshInterval);
	// await term();
})();
