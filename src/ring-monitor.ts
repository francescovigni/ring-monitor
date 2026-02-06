import { RingApi, RingDevice, RingDeviceType, Location, RingDeviceData } from 'ring-client-api';
import { Subject, Subscription } from 'rxjs';
import { skip, distinctUntilChanged } from 'rxjs/operators';

export interface AlarmEvent {
  timestamp: Date;
  locationName: string;
  locationId: string;
  deviceName: string;
  deviceType: string;
  eventType: string;
  details: Record<string, unknown>;
}

// Use intersection type to allow additional properties
type ExtendedDeviceData = RingDeviceData & {
  flood?: { faulted?: boolean };
  freeze?: { faulted?: boolean };
  lastLockAction?: string;
  alarmClearingDue?: unknown;
  lastUserAction?: unknown;
};

export class RingAlarmMonitor {
  private ringApi: RingApi;
  private subscriptions: Subscription[] = [];
  private deviceStates: Map<string, Record<string, unknown>> = new Map();
  public onEvent = new Subject<AlarmEvent>();
  public onRefreshTokenUpdate = new Subject<{ newRefreshToken: string; oldRefreshToken: string }>();

  constructor(refreshToken: string) {
    this.ringApi = new RingApi({
      refreshToken,
      debug: false,
      controlCenterDisplayName: 'ring-alarm-sheets-monitor',
    });

    // Subscribe to refresh token updates
    this.ringApi.onRefreshTokenUpdated.subscribe(({ newRefreshToken, oldRefreshToken }) => {
      if (oldRefreshToken) {
        this.onRefreshTokenUpdate.next({ newRefreshToken, oldRefreshToken });
      }
    });
  }

  async start(): Promise<void> {
    console.log('🔔 Starting Ring Alarm Monitor...');
    
    const locations = await this.ringApi.getLocations();
    console.log(`📍 Found ${locations.length} location(s)`);

    for (const location of locations) {
      await this.monitorLocation(location);
    }
  }

  private async monitorLocation(location: Location): Promise<void> {
    console.log(`📍 Monitoring location: ${location.name}`);

    // Monitor connection status changes (skip initial state, only log actual changes)
    const connectionSub = location.onConnected.pipe(
      skip(1), // Skip initial state
      distinctUntilChanged() // Only emit when value actually changes
    ).subscribe((connected) => {
      this.emitEvent({
        timestamp: new Date(),
        locationName: location.name,
        locationId: location.id,
        deviceName: 'Hub',
        deviceType: 'connection',
        eventType: connected ? 'connected' : 'disconnected',
        details: { connected },
      });
    });
    this.subscriptions.push(connectionSub);

    // Monitor alarm devices if location has hubs (alarm system)
    if (location.hasHubs || location.hasAlarmBaseStation) {
      try {
        // Add timeout to prevent hanging forever
        const timeoutPromise = new Promise<never>((_, reject) => 
          setTimeout(() => reject(new Error('getDevices() timed out after 30 seconds')), 30000)
        );
        
        const devices = await Promise.race([location.getDevices(), timeoutPromise]);
        console.log(`  📟 Found ${devices.length} device(s) at ${location.name}`);

        for (const device of devices) {
          this.monitorDevice(device, location);
        }
      } catch (error) {
        console.error(`  ⚠️ Error getting devices for ${location.name}:`, error);
      }
    }

    // Monitor cameras for motion and doorbell events
    for (const camera of location.cameras) {
      console.log(`  📷 Monitoring camera: ${camera.name}`);

      const motionSub = camera.onMotionDetected.subscribe((motionDetected) => {
        if (motionDetected) {
          this.emitEvent({
            timestamp: new Date(),
            locationName: location.name,
            locationId: location.id,
            deviceName: camera.name,
            deviceType: 'camera',
            eventType: 'motion_detected',
            details: { cameraId: camera.id },
          });
        }
      });
      this.subscriptions.push(motionSub);

      if (camera.isDoorbot) {
        const doorbellSub = camera.onDoorbellPressed.subscribe((ding) => {
          this.emitEvent({
            timestamp: new Date(),
            locationName: location.name,
            locationId: location.id,
            deviceName: camera.name,
            deviceType: 'doorbell',
            eventType: 'doorbell_pressed',
            details: { dingId: (ding as unknown as { data?: { gcmData?: { ding?: { id?: string } } } }).data?.gcmData?.ding?.id },
          });
        });
        this.subscriptions.push(doorbellSub);
      }
    }
  }

  private monitorDevice(device: RingDevice, location: Location): void {
    const deviceTypeName = this.getDeviceTypeName(device.deviceType);
    const deviceKey = `${location.id}-${device.zid}`;
    console.log(`    🔹 ${device.name} (${deviceTypeName})`);

    const dataSub = device.onData.subscribe((data) => {
      const previousState = this.deviceStates.get(deviceKey) || {};
      const currentState = data as ExtendedDeviceData;
      
      // Detect state changes worth logging
      const events = this.detectDeviceStateChanges(device, previousState, currentState);
      
      // Store current state for next comparison
      this.deviceStates.set(deviceKey, { ...currentState });
      
      for (const event of events) {
        this.emitEvent({
          timestamp: new Date(),
          locationName: location.name,
          locationId: location.id,
          deviceName: device.name,
          deviceType: deviceTypeName,
          eventType: event.type,
          details: event.details,
        });
      }
    });
    this.subscriptions.push(dataSub);
  }

  private detectDeviceStateChanges(
    device: RingDevice,
    previousState: Record<string, unknown>,
    currentState: ExtendedDeviceData
  ): Array<{ type: string; details: Record<string, unknown> }> {
    const events: Array<{ type: string; details: Record<string, unknown> }> = [];
    const isInitial = Object.keys(previousState).length === 0;

    // Alarm mode changes (security panel)
    if (device.deviceType === RingDeviceType.SecurityPanel) {
      const currentMode = currentState.mode as string;
      const previousMode = previousState.mode as string;
      
      // Log mode changes (or initial state)
      if (currentMode && (isInitial || currentMode !== previousMode)) {
        const modeNames: Record<string, string> = {
          'all': 'away',
          'some': 'home', 
          'none': 'disarmed'
        };
        events.push({
          type: `alarm_${modeNames[currentMode] || currentMode}`,
          details: { 
            mode: currentMode, 
            previousMode: previousMode || 'unknown',
            modeName: modeNames[currentMode] || currentMode 
          },
        });
      }

      // Active alarm
      const currentAlarmStatus = currentState.alarmStatus as string;
      const previousAlarmStatus = previousState.alarmStatus as string;
      if (currentAlarmStatus === 'active' && previousAlarmStatus !== 'active') {
        events.push({
          type: 'alarm_triggered',
          details: { alarmStatus: currentAlarmStatus },
        });
      }
    }

    // Entry/exit sensor (contact sensor)
    if (device.deviceType === RingDeviceType.ContactSensor) {
      const currentFaulted = currentState.faulted;
      const previousFaulted = previousState.faulted;
      
      if (currentFaulted !== previousFaulted) {
        events.push({
          type: currentFaulted ? 'sensor_opened' : 'sensor_closed',
          details: { faulted: currentFaulted, tamperStatus: currentState.tamperStatus },
        });
      }
    }

    // Motion sensor
    if (device.deviceType === RingDeviceType.MotionSensor) {
      const currentFaulted = currentState.faulted;
      const previousFaulted = previousState.faulted;
      
      if (currentFaulted && !previousFaulted) {
        events.push({
          type: 'motion_detected',
          details: { faulted: currentFaulted },
        });
      }
    }

    // Keypad events
    if (device.deviceType === RingDeviceType.Keypad) {
      const currentAction = JSON.stringify(currentState.lastUserAction);
      const previousAction = JSON.stringify(previousState.lastUserAction);
      
      if (currentState.lastUserAction && currentAction !== previousAction) {
        events.push({
          type: 'keypad_action',
          details: { lastUserAction: currentState.lastUserAction },
        });
      }
    }

    // Smoke/CO alarms
    if (
      device.deviceType === RingDeviceType.SmokeAlarm ||
      device.deviceType === RingDeviceType.CoAlarm ||
      device.deviceType === RingDeviceType.SmokeCoListener
    ) {
      const currentAlarmStatus = currentState.alarmStatus as string;
      const previousAlarmStatus = previousState.alarmStatus as string;
      
      if (currentAlarmStatus === 'active' && previousAlarmStatus !== 'active') {
        events.push({
          type: 'smoke_co_alarm',
          details: { alarmStatus: currentAlarmStatus, smoke: currentState.smoke, co: currentState.co },
        });
      }
    }

    // Flood/freeze sensor
    if (device.deviceType === RingDeviceType.FloodFreezeSensor) {
      const currentFloodFaulted = currentState.flood?.faulted;
      const currentFreezeFaulted = currentState.freeze?.faulted;
      const previousFloodFaulted = (previousState.flood as { faulted?: boolean })?.faulted;
      const previousFreezeFaulted = (previousState.freeze as { faulted?: boolean })?.faulted;
      
      if ((currentFloodFaulted && !previousFloodFaulted) || (currentFreezeFaulted && !previousFreezeFaulted)) {
        events.push({
          type: 'flood_freeze_alert',
          details: { flood: currentState.flood, freeze: currentState.freeze },
        });
      }
    }

    // Lock status (check by device type string)
    const deviceTypeStr = device.deviceType as string;
    if (deviceTypeStr === 'lock' || deviceTypeStr === 'lock.zwave') {
      const currentLocked = currentState.locked;
      const previousLocked = previousState.locked;
      
      if (currentLocked !== previousLocked) {
        events.push({
          type: currentLocked ? 'lock_locked' : 'lock_unlocked',
          details: { locked: currentLocked, lockAction: currentState.lastLockAction },
        });
      }
    }

    // Low battery (only log once when it drops below 20%)
    const currentBattery = currentState.batteryLevel as number | undefined;
    const previousBattery = previousState.batteryLevel as number | undefined;
    if (currentBattery !== undefined && currentBattery < 20 && (previousBattery === undefined || previousBattery >= 20)) {
      events.push({
        type: 'low_battery',
        details: { batteryLevel: currentBattery },
      });
    }

    // Tamper status
    const currentTamper = currentState.tamperStatus;
    const previousTamper = previousState.tamperStatus;
    if (currentTamper === 'tamper' && previousTamper !== 'tamper') {
      events.push({
        type: 'tamper_detected',
        details: { tamperStatus: currentTamper },
      });
    }

    return events;
  }

  private getDeviceTypeName(deviceType: string): string {
    const typeMap: Record<string, string> = {
      [RingDeviceType.SecurityPanel]: 'Security Panel',
      [RingDeviceType.ContactSensor]: 'Contact Sensor',
      [RingDeviceType.MotionSensor]: 'Motion Sensor',
      [RingDeviceType.FloodFreezeSensor]: 'Flood/Freeze Sensor',
      [RingDeviceType.SmokeAlarm]: 'Smoke Alarm',
      [RingDeviceType.CoAlarm]: 'CO Alarm',
      [RingDeviceType.SmokeCoListener]: 'Smoke/CO Listener',
      [RingDeviceType.Keypad]: 'Keypad',
      [RingDeviceType.BaseStation]: 'Base Station',
      [RingDeviceType.RangeExtender]: 'Range Extender',
      'lock': 'Lock',
      'lock.zwave': 'Lock',
      'switch.multilevel': 'Dimmer Switch',
      'switch': 'Switch',
    };
    return typeMap[deviceType] || deviceType;
  }

  private emitEvent(event: AlarmEvent): void {
    console.log(
      `📢 [${event.timestamp.toISOString()}] ${event.locationName} - ${event.deviceName}: ${event.eventType}`
    );
    this.onEvent.next(event);
  }

  stop(): void {
    console.log('🛑 Stopping Ring Alarm Monitor...');
    for (const sub of this.subscriptions) {
      sub.unsubscribe();
    }
    this.subscriptions = [];
    this.ringApi.disconnect();
  }
}
