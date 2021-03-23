#include "Arduino.h"
#include <PID_v2.h> // https://github.com/gelraen/Arduino-PID-Library


// Debug macro to print messages to serial
#define DEBUG(x)   if (Serial) { Serial.print(x);   }
#define DEBUGLN(x) if (Serial) { Serial.println(x); }

// Pins
#define PWM_OUT_FAN0 3 // PWM output pin

// Minimum and maximum fan duty cycle
double pwmMin =  7.0;
double pwmMax = 79.0;

// PID control tuning parameters
// Great writeup: https://github.com/CapnBry/HeaterMeter/wiki/PID-Controller-Theory
double KP = 1.8; // Determines how aggressively the PID reacts to current amount of error (Proportional)
double KI = 1.8; // Determines how aggressively the PID reacts to error over time         (Integral)
double KD = 7.2; // Determines how aggressively the PID reacts to change in error         (Derivative)

// Temperature target for PID control
double temperatureTarget = 31.0;

// Temperature sent from host
double temperatureCurrent = temperatureTarget;

boolean pidControl = true;

// PWM duty value
double dutyPID;
double dutyLast;


String inputString = "";


// Initialize PID library
PID_v2 fan0PID(KP, KI, KD, PID::Reverse);



void pwmDuty(double dutyNew) {
	if (pidControl == true) {
		dutyNew = dutyPID;
	}

	// Minimum start speed workaround
	if (dutyNew < 8.0) {
		dutyNew = 0;
	}

	// Return now if new duty value is the same as the last
	if (dutyNew == dutyLast) return;

	// DEBUG("pwmDuty() :: dutyNew = "); DEBUGLN(dutyNew);
	dutyLast = dutyNew;

	byte ocrValue = (byte) dutyNew;
	// DEBUG("pwmDuty() :: ocrValue = "); DEBUGLN(ocrValue);

	OCR2B = ocrValue;
}

void setManual(int newFanSpeed) {
	// DEBUG("setManual() :: newFanSpeed = "); DEBUGLN(newFanSpeed);

	if (newFanSpeed == 255) {
		pidControl = true;
		pwmDuty(dutyPID);
		return;
	}

	pidControl = false;

	pwmDuty(newFanSpeed);

	outputJSON();
}

void setTemp(double newTemp) {
	// DEBUG("setTemp() :: newTemp = "); DEBUGLN(newTemp);
	temperatureCurrent = newTemp;

	dutyPID = fan0PID.Run(temperatureCurrent);
	pwmDuty(dutyPID);

	outputJSON();
}


// JSON data output
void outputJSON() {
	// Calculate/format fan duty cycle percentage
	unsigned int pwmDutyPct = 0;

	if (dutyLast != 0) {
		pwmDutyPct = map(round(dutyLast), pwmMin, pwmMax, 0, 100);
	}

	DEBUG("{ ");
	DEBUG("\"temperatureCurrent\": "); DEBUG(temperatureCurrent); DEBUG(", ");
	DEBUG("\"pwmDutyPct\": "); DEBUG(pwmDutyPct); DEBUG(", ");
	DEBUG("\"pidControl\": "); DEBUG(pidControl);
	DEBUGLN(" }");
}


void loop() {
	while (Serial.available()) {
		// Get the new char
		char inChar = (char) Serial.read();

		// DEBUG("loop() :: inChar = "); DEBUGLN(inChar);
		// DEBUG("loop() :: inputString = "); DEBUGLN(inputString);

		if (inChar == '\n') {
			// DEBUG("loop() :: inputString = "); DEBUGLN(inputString);
			String commandString = inputString.substring(1, 4);
			// DEBUG("loop() :: commandString = "); DEBUGLN(commandString);

			if (commandString.equals("set")) {
				int newFanSpeed = (inputString.substring(4, inputString.length())).toInt();
				setManual(newFanSpeed);
			}

			if (commandString.equals("tmp")) {
				double newTemp = (inputString.substring(4, inputString.length())).toDouble();
				setTemp(newTemp);
			}

			inputString = "";
		}
		else {
			// Add it to the inputString
			inputString += inChar;
		}
	}
}


void setup25kHzPwm() {
	TCCR2A = 0; // TC2 control register A
	TCCR2B = 0; // TC2 control register B

	TIMSK2 = 0; // TC2 interrupt mask register
	TIFR2  = 0; // TC2 interrupt flag register

	TCCR2A |= (1 << COM2B1) | (1 << WGM21) | (1 << WGM20); // OC2B cleared/set on match when up/down counting, fast PWM
	TCCR2B |= (1 << WGM22)  | (1 << CS21);                 // prescaler 8

	OCR2A = pwmMax; // TOP overflow value (Hz)
	OCR2B = 0;
}

void setup() {
	// Start serial connection
	Serial.begin(115200);

	// DEBUGLN("[INIT] Fan control");
	pinMode(PWM_OUT_FAN0, OUTPUT);
	setup25kHzPwm();
	pwmDuty(pwmMin);

	// DEBUGLN("[INIT] PID control");
	fan0PID.SetOutputLimits(pwmMin, pwmMax);
	fan0PID.SetSampleTime(2000);
	fan0PID.Start(temperatureCurrent, pwmMin, temperatureTarget);

	// DEBUGLN("[INIT] Complete");
}
