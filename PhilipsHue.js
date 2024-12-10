export function Name() { return "Philips Hue"; }
export function Version() { return "1.1.0"; }
export function Type() { return "network"; }
export function Publisher() { return "WhirlwindFX"; }
export function Size() { return [3, 3]; }
export function DefaultPosition() {return [75, 70]; }
export function DefaultScale(){return 8.0;}
export function SubdeviceController(){ return true;}
/* global
controller:readonly
discovery: readonly
TakeActiveStream:readonly
*/
export function ControllableParameters() {
	return [
		{"property":"TakeActiveStream", "group":"settings", "label":"Override active stream", "type":"boolean", "default":"false"},
    {"property":"disconnectColor", "group":"lighting", "label":"Disable Color", "type":"color", "default":"#ffca8b"},
	];
}
let CurrentArea = "";
let isStreamOpen = false;
let isStreamActive = false;

let isDtlsConnectionAlive = false;
const lastConnectionAttemptTime = Date.now();

export function Initialize() {
	device.addFeature("dtls");

	if(controller.name){
		device.setName(controller.name);
	}

	createLightsForArea(controller.selectedArea);

	const AreaInfo = GetAreaInfo(controller.selectedArea);

	if(AreaInfo.stream.active){
		device.log("Bridge has an active stream!");
		isStreamActive = true;

		if(AreaInfo.stream.owner === controller.username){
			device.log(`We own the active stream??? Lets bash it!`);
			StopStream();
		}else{
			device.log(`We don't own the active stream!`);

			if(TakeActiveStream){
				device.log(`Stealing Active Stream!`);

				StopStream();
			}
		}
	}
}

function GetAreaInfo(areaId){
	let output = {};
	XmlHttp.Get(`http://${controller.ip}/api/${controller.username}/groups/${areaId}`,
		(xhr) => {
			if (xhr.readyState === 4 && xhr.status === 200){
				//device.log(xhr.responseText);

				const response = JSON.parse(xhr.response);
				output = response;
			}
		});

	return output;
}

function onConnectionMade(){
	device.log("Connection Made!");
	isDtlsConnectionAlive = true;
}

function onConnectionClosed(){
	device.log("Connection Lost!");
	isDtlsConnectionAlive = false;
}

function onConnectionError(){
	device.log("Connection Error!");
	isDtlsConnectionAlive = false;
}

function onStreamStarted(){
	if(isStreamOpen){
		return;
	}

	device.log(`Stream Started!`);

	isStreamOpen = true;
	device.log("Starting Dtls Handshake...");

	dtls.onConnectionEstablished(onConnectionMade);
	dtls.onConnectionClosed(onConnectionClosed);
	dtls.onConnectionError(onConnectionError);

	dtls.createConnection(controller.ip, 2100, controller.username, controller.key);
}

function onStreamStopped(){
	device.log(`Stream Stopped!`);
	isStreamOpen = false;
	isStreamActive = false;
}

function getColors(){

	const Lights = controller.areas[controller.selectedArea].lights;
	const RGBData = new Array(9 * Lights.length);
	let index = 0;

	for(let i = 0; i < Lights.length; i++) {
		const lightId = Lights[i];

		RGBData[index] = 0;
		RGBData[index+1] = 0;
		RGBData[index+2] = lightId;

		const color = device.subdeviceColor(`Philips Hue Light: ${lightId}`, 1, 1);

		color[0] = mapu8Tou16(color[0]);
		color[1] = mapu8Tou16(color[1]);
		color[2] = mapu8Tou16(color[2]);

		RGBData[index+3] = (color[0] >> 8);
		RGBData[index+4] = color[0] & 0xFF;
		RGBData[index+5] = (color[1] >> 8);
		RGBData[index+6] = color[1] & 0xFF;
		RGBData[index+7] = (color[2] >> 8);
		RGBData[index+8] = color[2] & 0xFF;

		index += 9;
	}

	return RGBData;
}

function getColorArr(r, g, b){

	const Lights = controller.areas[controller.selectedArea].lights;
	const RGBData = new Array(9 * Lights.length);
	let index = 0;

	for(let i = 0; i < Lights.length; i++) {
		const lightId = Lights[i];

		RGBData[index] = 0;
		RGBData[index+1] = 0;
		RGBData[index+2] = lightId;

		const color = [r,g,b]; //device.subdeviceColor(`Philips Hue Light: ${lightId}`, 1, 1);

		color[0] = mapu8Tou16(color[0]);
		color[1] = mapu8Tou16(color[1]);
		color[2] = mapu8Tou16(color[2]);

		RGBData[index+3] = (color[0] >> 8);
		RGBData[index+4] = color[0] & 0xFF;
		RGBData[index+5] = (color[1] >> 8);
		RGBData[index+6] = color[1] & 0xFF;
		RGBData[index+7] = (color[2] >> 8);
		RGBData[index+8] = color[2] & 0xFF;

		index += 9;
	}

	return RGBData;
}


function createHuePacket(RGBData){
	// for(let i = 0; i < 9; i++){
	// 	packet.push("HueStream".charCodeAt(i));
	// }
	let packet = [72, 117, 101, 83, 116, 114, 101, 97, 109];

	packet[9] = 0x01; //majv
	packet[10] = 0x00; //minv
	packet[11] = 0x00; //Seq
	packet[12] = 0x00; //Reserved
	packet[13] = 0x00; //Reserved
	packet[14] = 0x00; //Color Space (0: RGB)
	packet[15] = 0x01; // Linear filter.

	packet = packet.concat(RGBData);

	return packet;
}

function StartStream(){
	XmlHttp.Put(`http://${controller.ip}/api/${controller.username}/groups/${CurrentArea}`,
		(xhr) => {
			if (xhr.readyState === 4 && xhr.status === 200){
				device.log(xhr.responseText);

				const response = JSON.parse(xhr.response);

				if(response.length > 0){
					if(response[0].hasOwnProperty("success")){
						onStreamStarted();
					}
				}
			}
		},
		{stream: {active: true}}
	);
}

function hexToRgb(hex) {
  var result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : null;
}

function StopStream()
{
  // Fetch shutdown color (we set this prior to disable)
  const vColor = hexToRgb(disconnectColor);
  
  // Build pre-shutdown dtls packet.
  const xPacket = createHuePacket(getColorArr(vColor.r,vColor.g,vColor.b));

  // Full send.
  const iRet = dtls.send(xPacket); 

  // Its udp...can't hurt.
  dtls.send(xPacket);

  // Terminate the stream.
  CloseStream();
}

function CloseStream()
{  
	XmlHttp.Put(`http://${controller.ip}/api/${controller.username}/groups/${CurrentArea}`,
		(xhr) => {
			if (xhr.readyState === 4 && xhr.status === 200){
				device.log(xhr.responseText);

				const response = JSON.parse(xhr.response);

				if(response.length > 0){
					if(response[0].hasOwnProperty("success")){
						onStreamStopped();
					}
				}
			}
		},
		{stream: {active: false}}
	);
}
let waitingForConnectionClose = false;
let LastStreamCheck;
const STREAM_CHECK_INTERVAL = 5000;

export function Render() {
	if(isStreamActive){
		if(LastStreamCheck >= Date.now() - STREAM_CHECK_INTERVAL){
			return;
		}

		const AreaInfo = GetAreaInfo(CurrentArea);

		if(!AreaInfo.stream.active){
			isStreamActive = false;
		}

		if(TakeActiveStream){
			device.log(`Stealing Active Stream!`);
			StopStream();
		}

		LastStreamCheck = Date.now();

		return;
	}

	// if(waitingForConnectionClose){
	// 	device.log(`Waiting for Connection Closure!`);

	// 	if(!isStreamOpen && !isDtlsConnectionAlive){
	// 		waitingForConnectionClose = false;
	// 	}

	// 	return;
	// }

	if(CurrentArea != controller.selectedArea){
		device.log([CurrentArea, controller.selectedArea]);

		device.log(`Selected Area Changed! Closing Connection!`);
		CloseDtlsSocket();
		waitingForConnectionClose = true;
		device.log(`Selected Area Changed! Recreating Subdevices!`);
		createLightsForArea(controller.selectedArea);

		return;
	}

	if(!isStreamOpen && !isDtlsConnectionAlive){
		StartStream();
	}

	if(isStreamOpen && isDtlsConnectionAlive){
		const iRet = dtls.send(createHuePacket(getColors()));

		if(iRet < 0){
			device.log(`send(): Returned ${iRet}!`);
		}
	}
}

function mapu8Tou16(byte){
	return Math.floor((byte / 0xFF) * 0xFFFF);
}

function CloseDtlsSocket(){
	device.log(`Closing Dtls connection!`);

	if(isStreamOpen && isDtlsConnectionAlive){
		StopStream();
	}

	if(isDtlsConnectionAlive){
		dtls.CloseConnection();
	}

}

export function Shutdown() {
	CloseDtlsSocket();
}

function createLightsForArea(AreaId){

	for(const subdeviceId of device.getCurrentSubdevices()){
		device.log(`Removing Light: ${subdeviceId}`);
		device.removeSubdevice(subdeviceId);
	}

	device.log(`Lights in current area: [${controller.areas[AreaId].lights}]`);

	for(const light of controller.areas[AreaId].lights){
		device.log(`Adding Light: ${light}`);
		device.createSubdevice(`Philips Hue Light: ${light}`);
		device.setSubdeviceName(`Philips Hue Light: ${light}`, controller.lights[light].name);
		device.setSubdeviceSize(`Philips Hue Light: ${light}`, 3, 3);
		device.setSubdeviceImage(`Philips Hue Light: ${light}`, "");
		device.setSubdeviceLeds(`Philips Hue Light: ${light}`, ["Device"], [[1, 1]]);
	}

	CurrentArea = AreaId;
}
// -------------------------------------------<( Discovery Service )>--------------------------------------------------


export function DiscoveryService() {
	this.IconUrl = "https://assets.signalrgb.com/brands/philips/logo.png";


this.MDns = [
    "_hue._tcp.local.",
    "_diyhue._tcp.local.",
    "192.168.178.136"
];

this.Initialize = function() {
    service.log("Initializing Plugin!");
    service.log("Searching for network devices...");

    // Add specific IP to the discovery process
    this.AddStaticDevice("192.168.178.136");
};

this.AddStaticDevice = function(ip) {
    const value = {
        hostname: ip,
        name: "Static Hue Bridge",
        port: 80,
        id: ip,
        model: "StaticModel"
    };
    this.CreateController(value);
};

	this.firstrun = true;
	this.cache = new IPCache();

	this.Initialize = function(){
		service.log("Initializing Plugin!");
		service.log("Searching for network devices...");
	};

	this.Update = function(){
		for(const cont of service.controllers){
			cont.obj.update();
		}

		if(this.firstrun){
			this.firstrun = false;
			this.LoadCachedDevices();
		}

	};

	this.Shutdown = function(){

	};

	this.Discovered = function(value) {
		service.log(`New host discovered!`);
		service.log(value);
		this.CreateController(value);
	};

	this.Removal = function(value){
		service.log(`${value.hostname} was removed from the network!`);

		// for(const controller of service.controllers){
		// 	if(controller.id === value.bridgeid){
		// 		service.suppressController(controller);
		// 		service.removeController(controller);

		// 		return;
		// 	}
		// }
	};

	this.CreateController = function(value){
		const bridgeid = value?.bridgeid ?? value?.id;
		const controller = service.getController(bridgeid);

		if (controller === undefined) {
			service.addController(new HueBridge(value));
		} else {
			controller.updateWithValue(value);
			service.log(`Updated: ${controller.bridgeid}`);
		}
	};

	this.LoadCachedDevices = function(){
		service.log("Loading Cached Devices...");

		for(const [key, value] of this.cache.Entries()){
			service.log(`Found Cached Device: [${key}: ${JSON.stringify(value)}]`);
			this.CreateController(value);
		}
	};

	this.forgetBridge = function(bridgeId){
		// Remove from ip cache
		this.cache.Remove(bridgeId);
		// remove from UI
		for(const controller of service.controllers){
			if(controller.id === bridgeId){
				service.suppressController(controller);
				service.removeController(controller);
				
				return;
			}
		}
	}
}


class HueBridge {
	constructor(value){
		this.updateWithValue(value);

		this.ip = "";
		this.key = service.getSetting(this.id, "key") ?? "";
		this.username = service.getSetting(this.id, "username") ?? "";
		this.areas = {};
		this.lights = {};
		this.connected = this.key != "";
		this.retriesleft = 60;
		this.waitingforlink = false;
		this.selectedArea = service.getSetting(this.id, "selectedArea") ?? "";
		this.selectedAreaName = service.getSetting(this.id, "selectedAreaName") ?? "";
		this.instantiated = false;
		this.lastPollingTimeStamp = 0;
		this.pollingInterval = 60000;
		this.supportsStreaming = false;
		this.apiversion = "";
		this.currentlyValidatingIP = false;
		this.currentlyResolvingIP = false;
		this.failedToValidateIP = false;

		this.DumpBridgeInfo();

		const ip = value?.ip;

		if(ip){
			this.ValidateIPAddress(ip);
		}else{
			this.ResolveIpAddress();
		}
	}

	ValidateIPAddress(ip){
		this.currentlyValidatingIP = true;
		service.updateController(this);

		const instance = this;
		service.log(`Attempting to validate ip address: ${ip}`);

		// We could just check if the ip has something at it, but I'd like to know if we specifically have a hue device at that ip
		XmlHttp.Get(`http://${ip}/api/config`, (xhr) => {
			service.log(`ValidateIPAddress: State: ${xhr.readyState}, Status: ${xhr.status}`);

			if (xhr.readyState !== 4) {
				return;
			}

			if(xhr.status === 200){
				service.log(`ip [${ip}] made a valid call!`);
				instance.ip = ip;
				instance.SetConfig(JSON.parse(xhr.response));
			}

			if(xhr.status === 0){
				service.log(`Error: ip [${ip}] made an invalid call! It's likely not a valid ip address for a Hue device...`);
				instance.failedToValidateIP = true;
				instance.ResolveIpAddress();
			}

			instance.currentlyValidatingIP = false;
			service.updateController(instance);
		},
		true);
	}

	cacheControllerInfo(){
		discovery.cache.Add(this.id, {
			hostname: this.hostname,
			name: this.name,
			port: this.port,
			modelid: this.model,
			bridgeid: this.id,
			ip: this.ip
		});
	}

	DumpBridgeInfo(){
		service.log("hostname: "+this.hostname);
		service.log("name: "+this.name);
		service.log("port: "+this.port);
		service.log("id: "+this.id);
		service.log("ip: " + (this.ip || "unknown"));
		service.log("model: "+this.model);
		service.log("username: "+(this.username || "unknown"));
		service.log("key: "+(this.key || "unknown"));
		service.log("selectedArea: "+(this.selectedArea || "unknown"));
		service.log("selectedAreaName: "+(this.selectedAreaName || "unknown"));
	}

	ForgetLink(){
		service.saveSetting(this.id, "key", undefined);
		service.saveSetting(this.id, "username", undefined);
		this.key = "";
		this.username = "";
		this.connected = false;
	}

	ResolveIpAddress(){
		service.log("Attempting to resolve IPV4 address...");

		const instance = this;
		service.resolve(this.hostname, (host) => {
			if(host.protocol === "IPV4"){
				instance.ip = host.ip;
				service.log(`Found IPV4 address: ${host.ip}`);
				//service.saveSetting(instance.id, "ip", instance.ip);
				instance.RequestBridgeConfig();

				instance.cacheControllerInfo();
				this.currentlyResolvingIP = false;
				this.failedToValidateIP = false;
				service.updateController(instance); //notify ui.
			}else if(host.protocol === "IPV6"){
				service.log(`Skipping IPV6 address: ${host.ip}`);
			}else{
				service.log(`unknown IP config: [${JSON.stringify(host)}]`);
			}

			//service.log(host);
		});
	}

	CreateBridgeDevice(){
		service.updateController(this);

		// Instantiate device in SignalRGB, and pass 'this' object to device.
		service.announceController(this);
	}

	setSelectedArea(AreaId){
		if(this.areas.hasOwnProperty(AreaId)){
			this.selectedArea = AreaId;
			service.log(this.areas[AreaId].name);
			this.selectedAreaName = this.areas[AreaId].name;
			service.saveSetting(this.id, "selectedArea", this.selectedArea);
			service.saveSetting(this.id, "selectedAreaName", this.selectedAreaName);
			service.updateController(this);
			service.log(`Set Selected Area to: [${this.selectedAreaName}], Id: [${this.selectedArea}]`);
		}
	}

	updateWithValue(value){
		service.log(value);
		this.hostname = value.hostname;

		// Keep bridge name if we have it
		if(!this.config?.name){
			this.name = value.name;
		}

		this.port = value.port;
		this.id = value.hasOwnProperty("bridgeid") ? value.bridgeid : value.id;
		this.model = value.hasOwnProperty("bridgeid") ? value.modelid : value.md;

		service.log("Updated: " + this.name);
		service.updateController(this);
	}

	setClientKey(response) {
		service.log("Setting key: "+ response.clientkey);

		// Save token.
		this.key = response.clientkey;
		service.saveSetting(this.id, "key", this.key);

		this.username = response.username;
		service.saveSetting(this.id, "username", this.username);

		this.retriesleft = 0;
		this.waitingforlink = false;
		this.connected = true;
		service.updateController(this);
	}

	requestLink(){
		const instance = this;
		service.log("requesting link for "+this.name);

		XmlHttp.Post(`http://${this.ip}/api`, (xhr) => {
			if (xhr.readyState === 4 && xhr.status === 200) {
				service.log(`Make Request: State: ${xhr.readyState}, Status: ${xhr.status}`);

				const response = JSON.parse(xhr.response)[0];
				service.log(JSON.stringify(response));

				if(response.error === undefined && response.success){
					instance.setClientKey(response.success);
				}
			}
		},
		{devicetype: "SignalRGB", generateclientkey: true},
		true);

	}

	startLink() {
		service.log("Pushlink test for "+this.name);
		this.retriesleft = 60;
		this.waitingforlink = true; //pretend we're connected.

		service.updateController(this); //notify ui.
	}

	// TODO: this should just be a FSM at this point...
	update() {
		if(this.currentlyValidatingIP){
			return;
		}

		if(this.failedToValidateIP){
			return;
		}

		if (this.waitingforlink){
			this.retriesleft--;
			this.requestLink();

			//service.log("Waiting for key from: "+ this.name+"...");
			if (this.retriesleft <= 0) {
				this.waitingforlink = false;
			}

			service.updateController(this);
		}

		if(!this.connected){
			service.updateController(this);

			return;
		}

		// if(!this.instantiated){
		// 	this.RequestLightInfo();
		// 	this.RequestAreaInfo();

		// 	if(Object.keys(this.areas).length > 0){
		// 		this.CreateBridgeDevice();
		// 		this.instantiated = true;
		// 	}

		// 	this.lastPollingTimeStamp = Date.now();
		// }

		if(!this.instantiated && this.lights && this.areas && Object.keys(this.areas).length > 0){
			this.CreateBridgeDevice();
			this.instantiated = true;


		}

		if(Date.now() - this.lastPollingTimeStamp > this.pollingInterval){
			service.log("Polling bridge Info...");
			this.RequestLightInfo();
			this.RequestAreaInfo();

			this.lastPollingTimeStamp = Date.now();
		}
	}

	RequestAreaInfo(){
		const instance = this;
		service.log("Requesting Area Info...");

		XmlHttp.Get(`http://${this.ip}/api/${this.username}/groups`, (xhr) => {
			if (xhr.readyState === 4 && xhr.status === 200) {
				//service.log("Areas:" + xhr.response);

				/** @type {Object.<number, EntertainmentArea>} */
				const response = JSON.parse(xhr.response);

				instance.areas = response;

				for(const AreaId in response){
					const Area = response[AreaId];

					if(!Area){
						continue;
					}

					// Save Id for later
					Area.id = AreaId;

					service.log(`Area: ${Area.name}`);
					service.log(`\tId: ${Area.id}`);
					service.log(`\tLights: ${Area.lights}`);
					service.log(`\tType: ${Area.type}`);

					if(Area.type !== "Entertainment"){
						service.log(`Skipping Area [${Area.name}:${Area.id}] because it's not a streamable entertainment area...`);
						delete instance.areas[Area.id];
					}

				}

				service.updateController(instance);

			}
		}, true);
	}

	RequestLightInfo(){
		const instance = this;
		service.log("Requesting Light Info...");

		XmlHttp.Get(`http://${this.ip}/api/${this.username}/lights`, (xhr) => {
			if (xhr.readyState !== 4){
				return;
			}

			if(xhr.status !== 200){
				service.log(`RequestLightInfo(): Error - Status [${xhr.status}]`);
			}

			if(xhr.status === 200) {

				/** @type {Object.<number, HueLight>} */
				const response = JSON.parse(xhr.response);
				instance.lights = response;

				for(const lightId in response){

					const light = response[lightId];

					if(!light){
						continue;
					}

					// Save Id for later
					light.id = lightId;

					service.log(`Light: ${light.id}`);
					service.log(`\tName: ${light.name}`);
					service.log(`\tProduct Name: ${light.productname}`);
					service.log(`\tType: ${light.type}`);
				}

				service.updateController(instance);
			}
		}, true);
	}

	SetConfig(response){
		this.config = response;
		service.log(JSON.stringify(this.config));
		this.apiversion = response.apiversion;
		service.log(`Api Version: ${this.apiversion}`);

		if(this.StreamableAPIVersion(this.apiversion)){
			this.supportsStreaming = true;
		}

		if(this.config.name && this.config.name !== "Philips hue"){
			this.name = this.config.name;
		}

		service.updateController(this);
	}

	StreamableAPIVersion(apiversion){
		return Semver.isGreaterThanOrEqual(apiversion, "1.22.0");
	}

	RequestBridgeConfig(){
		const instance = this;
		service.log(`Requesting bridge config...`);
		XmlHttp.Get(`http://${this.ip}/api/config`, (xhr) => {
			if (xhr.readyState === 4 && xhr.status === 200) {
				instance.SetConfig(JSON.parse(xhr.response));
			}
		}, true);
	}
}

// Swiper no XMLHttpRequest boilerplate!
class XmlHttp{
	static Get(url, callback, async = false){
		const xhr = new XMLHttpRequest();
		xhr.open("GET", url, async);

		xhr.setRequestHeader("Accept", "application/json");
		xhr.setRequestHeader("Content-Type", "application/json");

		xhr.onreadystatechange = callback.bind(null, xhr);

		xhr.send();
	}

	static Post(url, callback, data, async = false){
		const xhr = new XMLHttpRequest();
		xhr.open("POST", url, async);

		xhr.setRequestHeader("Accept", "application/json");
		xhr.setRequestHeader("Content-Type", "application/json");

		xhr.onreadystatechange = callback.bind(null, xhr);

		xhr.send(JSON.stringify(data));
	}

	static Put(url, callback, data, async = false){
		const xhr = new XMLHttpRequest();
		xhr.open("PUT", url, async);

		xhr.setRequestHeader("Accept", "application/json");
		xhr.setRequestHeader("Content-Type", "application/json");

		xhr.onreadystatechange = callback.bind(null, xhr);

		xhr.send(JSON.stringify(data));
	}
}

class IPCache{
	constructor(){
		this.cacheMap = new Map();
		this.persistanceId = "ipCache";
		this.persistanceKey = "cache";

		this.PopulateCacheFromStorage();
	}
	Add(key, value){
		service.log(`Adding ${key} to IP Cache...`);

		this.cacheMap.set(key, value);
		this.Persist();
	}

	Remove(key){
		this.cacheMap.delete(key);
		this.Persist();
	}
	Has(key){
		return this.cacheMap.has(key);
	}
	Get(key){
		return this.cacheMap.get(key);
	}
	Entries(){
		return this.cacheMap.entries();
	}

	PopulateCacheFromStorage(){
		service.log("Populating IP Cache from storage...");

		const storage = service.getSetting(this.persistanceId, this.persistanceKey);

		if(storage === undefined){
			service.log(`IP Cache is empty...`);

			return;
		}

		let mapValues;

		try{
			mapValues = JSON.parse(storage);
		}catch(e){
			service.log(e);
		}

		if(mapValues === undefined){
			service.log("Failed to load cache from storage! Cache is invalid!");

			return;
		}

		if(mapValues.length === 0){
			service.log(`IP Cache is empty...`);
		}

		this.cacheMap = new Map(mapValues);
	}

	Persist(){
		service.log("Saving IP Cache...");
		service.saveSetting(this.persistanceId, this.persistanceKey, JSON.stringify(Array.from(this.cacheMap.entries())));
	}

	DumpCache(){
		for(const [key, value] of this.cacheMap.entries()){
			service.log([key, value]);
		}
	}
}

class Semver{
	static isEqualTo(a, b){
		return this.compare(a, b) === 0;
	}
	static isGreaterThan(a, b){
		return this.compare(a, b) > 0;
	}
	static isLessThan(a, b){
		return this.compare(a, b) < 0;
	}
	static isGreaterThanOrEqual(a, b){
		return this.compare(a, b) >= 0;
	}
	static isLessThanOrEqual(a, b){
		return this.compare(a, b) <= 0;
	}

	static compare(a, b){
		const parsedA = a.split(".").map((x) => parseInt(x));
		const parsedB = b.split(".").map((x) => parseInt(x));

		return this.recursiveCompare(parsedA, parsedB);
	}

	static recursiveCompare(a, b){
		if (a.length === 0) { a = [0]; }

		if (b.length === 0) { b = [0]; }

		if (a[0] !== b[0] || (a.length === 1 && b.length === 1)) {
			if(a[0] < b[0]){
				return -1;
			}

			if(a[0] > b[0]){
				return 1;
			}

			return 0;

		}

		return this.recursiveCompare(a.slice(1), b.slice(1));
	}
}


export function ImageUrl(){
	return "https://assets.signalrgb.com/devices/brands/philips/misc/bridge.png";
}