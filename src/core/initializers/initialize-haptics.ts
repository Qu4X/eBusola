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

import { CorePlatform } from '@services/platform';
import { CoreHaptics } from '@services/haptics';

/**
 * Initializes global Material 3 haptic feedback listeners.
 */
export default async function(): Promise<void> {
    await CorePlatform.ready();

    if (!CoreHaptics.isSupported()) {
        return;
    }

    // 1. Pull-to-refresh haptic impact.
    document.addEventListener('ionRefresh', () => {
        CoreHaptics.impact('medium');
    }, { passive: true });

    // 2. Value changes for toggles, checkboxes, radios, segments, and sliders.
    document.addEventListener('ionChange', (event: Event) => {
        const path = event.composedPath ? event.composedPath() : [event.target];
        for (const el of path) {
            if (!(el instanceof HTMLElement)) {
                continue;
            }

            const tagName = el.tagName.toLowerCase();
            if (
                tagName === 'ion-toggle' ||
                tagName === 'ion-checkbox' ||
                tagName === 'ion-radio' ||
                tagName === 'ion-radio-group' ||
                tagName === 'ion-segment' ||
                tagName === 'ion-segment-button' ||
                tagName === 'ion-range'
            ) {
                CoreHaptics.selection();
                break;
            }
        }
    }, { passive: true });

    // 3. Tab navigation and font size segment buttons.
    document.addEventListener('click', (event: MouseEvent) => {
        const path = event.composedPath ? event.composedPath() : [];
        for (const el of path) {
            if (!(el instanceof HTMLElement)) {
                continue;
            }

            const tagName = el.tagName.toLowerCase();
            const isHapticTarget =
                tagName === 'ion-tab-button' ||
                tagName === 'ion-segment-button' ||
                el.classList.contains('md3-segment-chip') ||
                (tagName === 'button' && el.classList.contains('md3-segment-chip'));

            if (isHapticTarget) {
                CoreHaptics.selection();
                break;
            }
        }
    }, { passive: true });
}
