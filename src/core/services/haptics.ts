// (C) Copyright 2015 Moodle Pty Ltd.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { Injectable } from '@angular/core';
import { makeSingleton } from '@singletons';
import { CorePlatform } from '@services/platform';
import { CoreConfig } from '@services/config';
import { CoreConfigSettingKey } from '@/core/constants';

/**
 * Haptic impact styles.
 */
export type CoreHapticImpactStyle = 'light' | 'medium' | 'heavy';

/**
 * Service providing Material 3 haptic and micro-tactile feedback.
 */
@Injectable({ providedIn: 'root' })
export class CoreHapticsService {

    protected enabled = true;
    protected initialized = false;
    protected lastTrigger = 0;
    protected static readonly MIN_INTERVAL = 40; // Cooldown in ms between rapid haptic events.

    constructor() {
        this.initialize();
    }

    /**
     * Initialize haptics state from stored config.
     */
    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }

        try {
            const val = await CoreConfig.get<number>(CoreConfigSettingKey.HAPTICS_ENABLED, 1);
            this.enabled = val !== 0;
            this.initialized = true;
        } catch {
            this.enabled = true;
            this.initialized = true;
        }
    }

    /**
     * Check if device hardware supports vibration.
     *
     * @returns True if vibration API exists.
     */
    isVibrationSupported(): boolean {
        return !CorePlatform.isAutomated() &&
            typeof navigator !== 'undefined' &&
            'vibrate' in navigator;
    }

    /**
     * Check if haptics/vibration is supported and enabled in current context.
     *
     * @returns True if supported and enabled.
     */
    isSupported(): boolean {
        return this.enabled && this.isVibrationSupported();
    }

    /**
     * Check if haptic feedback is currently enabled.
     */
    isEnabled(): boolean {
        return this.enabled;
    }

    /**
     * Enable or disable haptic feedback and persist state.
     *
     * @param enabled Whether haptics should be enabled.
     */
    async setEnabled(enabled: boolean): Promise<void> {
        this.enabled = enabled;
        await CoreConfig.set(CoreConfigSettingKey.HAPTICS_ENABLED, enabled ? 1 : 0);
    }

    /**
     * Trigger a subtle tick/selection feedback (e.g. tab clicks, toggle switch, radio pick).
     */
    selection(): void {
        this.trigger(8);
    }

    /**
     * Trigger an impact haptic pulse (e.g. pull-to-refresh, button action).
     *
     * @param style Impact strength ('light', 'medium', 'heavy').
     */
    impact(style: CoreHapticImpactStyle = 'medium'): void {
        switch (style) {
            case 'light':
                this.trigger(8);
                break;
            case 'heavy':
                this.trigger(22);
                break;
            case 'medium':
            default:
                this.trigger(14);
                break;
        }
    }

    /**
     * Trigger a success notification pattern (e.g. course activity marked complete, refresh finished).
     */
    success(): void {
        this.trigger([10, 35, 12]);
    }

    /**
     * Trigger a warning notification pattern.
     */
    warning(): void {
        this.trigger([15, 40, 15]);
    }

    /**
     * Trigger an error notification pattern.
     */
    error(): void {
        this.trigger([15, 40, 15, 40, 15]);
    }

    /**
     * Trigger vibration pattern with cooldown check.
     *
     * @param pattern Vibration duration (ms) or pattern array.
     */
    protected trigger(pattern: number | number[]): void {
        if (!this.isSupported()) {
            return;
        }

        const now = Date.now();
        if (now - this.lastTrigger < CoreHapticsService.MIN_INTERVAL) {
            return;
        }

        this.lastTrigger = now;

        try {
            navigator.vibrate(pattern);
        } catch {
            // Ignore vibration errors on unsupported or restricted contexts.
        }
    }

}

export const CoreHaptics = makeSingleton(CoreHapticsService);
