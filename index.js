let usb = require('usb');


let device = usb.findByIds(0x1B1C, 0x0C12);

console.log('device open');
device.open();



let deviceInterface = device.interfaces[0];

console.log('deviceInterface claim');
deviceInterface.claim();


let endpointIn  = deviceInterface.endpoints[0];
let endpointOut = deviceInterface.endpoints[1];


endpointIn.on('data', (data) => {
	console.log('\nendpointIn: %o\n', data);
});

endpointIn.on('error', (error) => {
	console.log('endpointIn error');
	console.log(error);
});


console.log('endpointIn polling start begin\n');
endpointIn.startPoll();


console.log('transfer 1 begin');
endpointOut.transfer([ 0xAA ], (error) => {
	console.log('transfer 1 end');

	if (error) {
		console.log('transfer 1 error');
		console.error(error);
		return;
	}

	console.log('transfer 1 OK\n');


	console.log('transfer 2 begin');
	endpointOut.transfer([ 0xAB ], (error) => {
		console.log('transfer 2 end');

		if (error) {
			console.log('transfer 2 error');
			console.error(error);
			return;
		}

		console.log('transfer 2 OK\n');


		console.log('transfer 3 begin');
		endpointOut.transfer([ 0xA9 ], (error) => {
			console.log('transfer 3 end');

			if (error) {
				console.log('transfer 3 error');
				console.error(error);
				return;
			}

			console.log('transfer 3 OK\n');


			setTimeout(() => {
				console.log('endpointIn polling stop begin');
				endpointIn.stopPoll(() => {
					console.log('endpointIn polling stop end\n');


					console.log('deviceInterface release begin');
					deviceInterface.release((error) => {
						console.log('deviceInterface release end');

						if (error) {
							console.log('deviceInterface release error');
							console.error(error);
							return;
						}

						console.log('deviceInterface release OK\n');


						console.log('device close');
						device.close();
						process.exit();
					});
				});
			}, 1000);
		});
	});
});
