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

import { addIcons } from 'ionicons';
import {
    home,
    homeOutline,
    school,
    schoolOutline,
    chatbubbles,
    chatbubblesOutline,
    notifications,
    notificationsOutline,
    ellipsisHorizontal,
    ellipsisHorizontalOutline,
    grid,
    gridOutline,
    camera,
    cameraOutline,
    settingsOutline,
    mailOutline,
    swapHorizontalOutline,
    logOutOutline,
    trashOutline,
    barChartOutline,
    trophyOutline,
    folderOutline,
    archiveOutline,
    syncOutline,
    alertCircleOutline,
    informationCircleOutline,
    buildOutline,
    serverOutline,
    chevronForwardOutline,
    chevronForward,
} from 'ionicons/icons';
import { CoreIcons } from '@static/icons';

/**
 * Add custom icons to Ionicons.
 */
export default function(): void {
    addIcons({
        home,
        'home-outline': homeOutline,
        school,
        'school-outline': schoolOutline,
        chatbubbles,
        'chatbubbles-outline': chatbubblesOutline,
        notifications,
        'notifications-outline': notificationsOutline,
        'ellipsis-horizontal': ellipsisHorizontal,
        'ellipsis-horizontal-outline': ellipsisHorizontalOutline,
        grid,
        'grid-outline': gridOutline,
        camera,
        'camera-outline': cameraOutline,
        'settings-outline': settingsOutline,
        'mail-outline': mailOutline,
        'swap-horizontal-outline': swapHorizontalOutline,
        'log-out-outline': logOutOutline,
        'trash-outline': trashOutline,
        'bar-chart-outline': barChartOutline,
        'trophy-outline': trophyOutline,
        'folder-outline': folderOutline,
        'archive-outline': archiveOutline,
        'sync-outline': syncOutline,
        'alert-circle-outline': alertCircleOutline,
        'information-circle-outline': informationCircleOutline,
        'build-outline': buildOutline,
        'server-outline': serverOutline,
        'chevron-forward-outline': chevronForwardOutline,
        'chevron-forward': chevronForward,
    });
    CoreIcons.addIconsToIonicons();
}
