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
import { CoreApp } from '@services/app';
import { CoreNetwork } from '@services/network';
import { CoreCronDelegate } from '@services/cron';
import { CoreEvents } from '@static/events';
import { CoreFilepool } from '@services/filepool';
import { CoreSite } from '@classes/sites/site';
import { CoreSites } from '@services/sites';
import { CorePromiseUtils } from '@static/promise-utils';
import { CoreConstants, CoreConfigSettingKey } from '@/core/constants';
import { CoreConfig } from '@services/config';
import { CoreFilter } from '@features/filter/services/filter';
import { CoreCourseDownloadStatusHelper } from '@features/course/services/course-download-status-helper';
import { makeSingleton, Translate } from '@singletons';
import { CoreError } from '@classes/errors/error';
import { Observable, Subject } from 'rxjs';
import { CoreErrorHelper } from '@services/error-helper';
import { CoreNavigator } from '@services/navigator';
import { CoreHTMLClasses } from '@static/html-classes';
import { CoreAlerts } from '@services/overlays/alerts';
import { Params } from '@angular/router';
import { CoreNative } from '@features/native/services/native';

/**
 * Object with space usage and cache entries that can be erased.
 */
export type CoreSiteSpaceUsage = {
    cacheEntries: number; // Number of cached entries that can be cleared.
    spaceUsage: number; // Space used in this site (total files + estimate of cache).
};

/**
 * Constants to define color schemes.
 */
export const enum CoreColorScheme {
    SYSTEM = 'system',
    LIGHT = 'light',
    DARK = 'dark',
}

/**
 * Constants to define zoom levels.
 */
export const enum CoreZoomLevel {
    NONE = 'none',
    MEDIUM = 'medium',
    HIGH = 'high',
}

/**
 * Settings helper service.
 */
@Injectable({ providedIn: 'root' })
export class CoreSettingsHelperProvider {

    protected syncPromises: { [s: string]: Promise<void> } = {};
    protected prefersDark?: MediaQueryList;
    protected colorSchemes: CoreColorScheme[] = [];
    protected currentColorScheme = CoreColorScheme.LIGHT;
    protected darkModeObservable = new Subject<boolean>();

    async initialize(): Promise<void> {
        this.prefersDark = window.matchMedia('(prefers-color-scheme: dark)');

        if (!CoreConstants.CONFIG.forceColorScheme) {
            // Update color scheme when a user enters or leaves a site, or when the site info is updated.
            const applySiteScheme = (): void => {
                if (this.isColorSchemeDisabledInSite()) {
                    // Dark mode is disabled, force light mode.
                    this.setColorScheme(CoreColorScheme.LIGHT);
                } else {
                    // Reset color scheme settings.
                    this.initColorScheme();
                }
            };

            CoreEvents.on(CoreEvents.LOGIN, () => applySiteScheme());

            CoreEvents.on(CoreEvents.SITE_UPDATED, () => applySiteScheme());

            CoreEvents.on(CoreEvents.LOGOUT, () => {
                // Reset color scheme settings.
                this.initColorScheme();
            });
        } else {
            this.initColorScheme();
        }

        // Listen for changes to the prefers-color-scheme media query.
        this.prefersDark.addEventListener && this.prefersDark.addEventListener('change', () => {
            this.setColorScheme(this.currentColorScheme);
        });

        // Init zoom level.
        await this.upgradeZoomLevel();

        this.initDomSettings();

        await this.applyDynamicColors();
    }

    /**
     * Deletes files of a site and the tables that can be cleared.
     *
     * @param siteName Site Name.
     * @param siteId Site ID.
     * @returns Resolved with detailed new info when done.
     */
    async deleteSiteStorage(siteName: string, siteId: string): Promise<CoreSiteSpaceUsage> {
        const siteInfo: CoreSiteSpaceUsage = {
            cacheEntries: 0,
            spaceUsage: 0,
        };

        siteName = await CoreFilter.formatText(siteName, { clean: true, singleLine: true, filter: false }, [], siteId);

        const title = Translate.instant('addon.storagemanager.confirmdeleteallsitedata');

        await CoreAlerts.confirmDelete(Translate.instant('addon.storagemanager.deleteallsitedatainfo', { name: siteName }), {
            header: title,
        });

        const site = await CoreSites.getSite(siteId);

        // Clear cache tables.
        const cleanSchemas = CoreSites.getSiteTableSchemasToClear(site);
        const promises: Promise<number | void>[] = cleanSchemas.map((name) => site.getDb().deleteRecords(name));

        promises.push(site.deleteFolder().then(() => {
            CoreFilepool.clearAllPackagesStatus(siteId);
            CoreFilepool.clearFilepool(siteId);
            CoreCourseDownloadStatusHelper.clearAllCoursesStatus(siteId);

            siteInfo.spaceUsage = 0;

            return;
        }).catch(async (error) => {
            if (error && error.code === FileError.NOT_FOUND_ERR) {
                // Not found, set size 0.
                CoreFilepool.clearAllPackagesStatus(siteId);
                siteInfo.spaceUsage = 0;
            } else {
                // Error, recalculate the site usage.
                CoreAlerts.showError(Translate.instant('addon.storagemanager.errordeletedownloadeddata'));

                siteInfo.spaceUsage = await site.getSpaceUsage();
            }
        }).then(async () => {
            CoreEvents.trigger(CoreEvents.SITE_STORAGE_DELETED, {}, siteId);

            siteInfo.cacheEntries = await this.calcSiteClearRows(site);

            return;
        }));

        await Promise.all(promises);

        return siteInfo;
    }

    /**
     * Calculates each site's usage, and the total usage.
     *
     * @param siteId ID of the site. Current site if undefined.
     * @returns Resolved with detailed info when done.
     */
    async getSiteSpaceUsage(siteId?: string): Promise<CoreSiteSpaceUsage> {
        const site = await CoreSites.getSite(siteId);

        // Get space usage.
        const siteInfo: CoreSiteSpaceUsage = {
            cacheEntries: 0,
            spaceUsage: 0,
        };

        siteInfo.cacheEntries = await CorePromiseUtils.ignoreErrors(this.calcSiteClearRows(site), 0);
        siteInfo.spaceUsage = await CorePromiseUtils.ignoreErrors(site.getTotalUsage(), 0);

        return siteInfo;
    }

    /**
     * Calculate the number of rows to be deleted on a site.
     *
     * @param site Site object.
     * @returns If there are rows to delete or not.
     */
    protected async calcSiteClearRows(site: CoreSite): Promise<number> {
        const clearTables = CoreSites.getSiteTableSchemasToClear(site);

        let totalEntries = 0;

        await Promise.all(clearTables.map(async (name) =>
            totalEntries = await site.getDb().countRecords(name) + totalEntries));

        return totalEntries;
    }

    /**
     * Get the synchronization promise of a site.
     *
     * @param siteId ID of the site.
     * @returns Sync promise or null if site is not being syncrhonized.
     */
    getSiteSyncPromise(siteId: string): Promise<void> | void {
        if (this.syncPromises[siteId] !== undefined) {
            return this.syncPromises[siteId];
        }
    }

    /**
     * Synchronize a site.
     *
     * @param syncOnlyOnWifi True to sync only on wifi, false otherwise.
     * @param siteId ID of the site to synchronize.
     * @returns Promise resolved when synchronized, rejected if failure.
     */
    async synchronizeSite(syncOnlyOnWifi: boolean, siteId: string): Promise<void> {
        if (this.syncPromises[siteId] !== undefined) {
            // There's already a sync ongoing for this site, return the promise.
            return this.syncPromises[siteId];
        }

        const site = await CoreSites.getSite(siteId);
        const hasSyncHandlers = CoreCronDelegate.hasManualSyncHandlers();

        // All these errors should not happen on manual sync because are prevented on UI.
        if (site.isLoggedOut()) {
            // Cannot sync logged out sites.
            throw new CoreError(Translate.instant('core.settings.cannotsyncloggedout'));
        } else if (hasSyncHandlers && !CoreNetwork.isOnline()) {
            // We need connection to execute sync.
            throw new CoreError(Translate.instant('core.settings.cannotsyncoffline'));
        } else if (hasSyncHandlers && syncOnlyOnWifi && CoreNetwork.isCellular()) {
            throw new CoreError(Translate.instant('core.settings.cannotsyncwithoutwifi'));
        }

        const syncPromise = Promise.all([
            // Invalidate all the site files so they are re-downloaded.
            CorePromiseUtils.ignoreErrors(CoreFilepool.invalidateAllFiles(siteId)),
            // Invalidate and synchronize site data.
            site.invalidateWsCache(),
            CoreSites.updateSiteInfo(site.getId()),
            CoreCronDelegate.forceSyncExecution(site.getId()),
        // eslint-disable-next-line arrow-body-style
        ]).then(() => {
            return;
        });

        this.syncPromises[siteId] = syncPromise;

        try {
            await syncPromise;
        } catch (error) {
            throw CoreErrorHelper.addTitleToError(error, Translate.instant('core.settings.sitesyncfailed'));
        } finally {
            delete this.syncPromises[siteId];
        }
    }

    /**
     * Upgrades from Font size to new zoom level.
     */
    async upgradeZoomLevel(): Promise<void> {
        // Check old setting and update the new.
        try {
            const fontSize = await CoreConfig.get<number>('CoreSettingsFontSize');
            if (fontSize === undefined) {
                // Already upgraded.
                return;
            }

            // Reset the value to solve edge cases.
            CoreConfig.set(CoreConfigSettingKey.ZOOM_LEVEL, CoreZoomLevel.NONE);

            if (fontSize < 100) {
                if (fontSize > 90) {
                    CoreConfig.set(CoreConfigSettingKey.ZOOM_LEVEL, CoreZoomLevel.HIGH);
                } else if (fontSize > 70) {
                    CoreConfig.set(CoreConfigSettingKey.ZOOM_LEVEL, CoreZoomLevel.MEDIUM);
                }
            }

            CoreConfig.delete('CoreSettingsFontSize');
        } catch {
            // Already upgraded.
            return;
        }
    }

    /**
     * Get saved Zoom Level setting.
     *
     * @returns The saved zoom Level option.
     */
    async getZoomLevel(): Promise<CoreZoomLevel> {
        return CoreConfig.get(CoreConfigSettingKey.ZOOM_LEVEL, CoreConstants.CONFIG.defaultZoomLevel);
    }

    /**
     * Get saved zoom level value.
     *
     * @returns The saved zoom level value in %.
     */
    async getZoom(): Promise<number> {
        const zoomLevel = await this.getZoomLevel();

        return CoreConstants.CONFIG.zoomlevels[zoomLevel];
    }

    /**
     * Get saved pinch-to-zoom setting.
     *
     * @returns True if pinch-to-zoom is enabled.
     */
    async getPinchToZoom(): Promise<boolean> {
        return Boolean(await CoreConfig.get(CoreConfigSettingKey.PINCH_TO_ZOOM, 0));
    }

    /**
     * Init Settings related to DOM.
     */
    async initDomSettings(): Promise<void> {
        // Set the font size based on user preference.
        const zoomLevel = await this.getZoomLevel();
        const pinchToZoom = await this.getPinchToZoom();

        this.applyZoomLevel(zoomLevel);
        this.applyPinchToZoom(pinchToZoom);

        this.initColorScheme();
    }

    /**
     * Init the color scheme.
     */
    async initColorScheme(): Promise<void> {
        if (CoreConstants.CONFIG.forceColorScheme) {
            this.setColorScheme(CoreConstants.CONFIG.forceColorScheme);
        } else {
            const scheme = await CoreConfig.get(CoreConfigSettingKey.COLOR_SCHEME, CoreColorScheme.LIGHT);
            this.setColorScheme(scheme);
        }
    }

    /**
     * Check if color scheme is disabled in a site.
     *
     * @param siteId Site ID. If not defined, current site.
     * @returns Promise resolved with whether color scheme is disabled.
     */
    async isColorSchemeDisabled(siteId?: string): Promise<boolean> {
        const site = await CoreSites.getSite(siteId);

        return this.isColorSchemeDisabledInSite(site);
    }

    /**
     * Check if color scheme is disabled in a site.
     *
     * @param site Site instance. If not defined, current site.
     * @returns Whether color scheme is disabled.
     */
    isColorSchemeDisabledInSite(site?: CoreSite): boolean {
        site = site || CoreSites.getCurrentSite();

        return site ? site.isFeatureDisabled('NoDelegate_DarkMode') : false;
    }

    /**
     * Set document default font size.
     *
     * @param zoomLevel Zoom Level.
     */
    applyZoomLevel(zoomLevel: CoreZoomLevel): void {
        const zoom = CoreConstants.CONFIG.zoomlevels[zoomLevel];

        document.documentElement.style.setProperty('--zoom-ratio', `${zoom / 100}`);
    }

    /**
     * Enable or disable pinch-to-zoom.
     *
     * @param pinchToZoom True if pinch-to-zoom should be enabled.
     */
    applyPinchToZoom(pinchToZoom: boolean): void {
        const element = document.head.querySelector('meta[name=viewport]');
        if (!element) {
            return;
        }
        const content = element.getAttribute('content');
        if (!content) {
            return;
        }

        element.setAttribute('content', content.replace(/maximum-scale=\d\.\d/, `maximum-scale=${pinchToZoom ? '2.0' : '1.0'}`));

        // Force layout reflow.
        document.body.style.width = '99.9999%';
        setTimeout(() => {
            document.body.style.width = '';
        });
    }

    /**
     * Get system allowed color schemes.
     *
     * @returns Allowed color schemes.
     */
    getAllowedColorSchemes(): CoreColorScheme[] {
        if (this.colorSchemes.length > 0) {
            return this.colorSchemes;
        }

        if (!CoreConstants.CONFIG.forceColorScheme) {
            this.colorSchemes.push(CoreColorScheme.LIGHT);
            this.colorSchemes.push(CoreColorScheme.DARK);

            if (this.canIUsePrefersColorScheme()) {
                this.colorSchemes.push(CoreColorScheme.SYSTEM);
            }
        } else {
            this.colorSchemes = [CoreConstants.CONFIG.forceColorScheme];
        }

        return this.colorSchemes;
    }

    /**
     * Set body color scheme.
     *
     * @param colorScheme Name of the color scheme.
     */
    setColorScheme(colorScheme: CoreColorScheme): void {
        this.currentColorScheme = colorScheme;
        if (colorScheme === CoreColorScheme.SYSTEM && this.prefersDark) {
            this.toggleDarkMode(this.prefersDark.matches);
        } else {
            this.toggleDarkMode(colorScheme === CoreColorScheme.DARK);
        }
    }

    /**
     * Check if device can detect color scheme system preference.
     * https://caniuse.com/prefers-color-scheme
     *
     * @returns if the color scheme system preference is available.
     */
    canIUsePrefersColorScheme(): boolean {
        // The following check will check browser support but system may differ from that.
        return window.matchMedia('(prefers-color-scheme)').media !== 'not all';
    }

    /**
     * Check if the dark mode is enabled.
     *
     * @returns True if the dark mode is enabled, false otherwise.
     */
    isDarkModeEnabled(): boolean {
        return CoreHTMLClasses.hasModeClass('dark');
    }

    /**
     * Toggles dark mode based on enabled boolean.
     *
     * @param enable True to enable dark mode, false to disable.
     */
    protected toggleDarkMode(enable = false): void {
        const isDark = this.isDarkModeEnabled();

        if (isDark !== enable) {
            CoreHTMLClasses.toggleModeClass('dark', enable);
            this.darkModeObservable.next(enable);

            this.applyDynamicColors();
            CoreApp.setSystemUIColors();
        }
    }

    /**
     * Applies Material You dynamic colors (Monet) to the document root.
     */
    async applyDynamicColors(): Promise<void> {
        const isEnabled = await CoreConfig.get<number>(CoreConfigSettingKey.DYNAMIC_COLOR_ENABLED, 0);
        if (!isEnabled) {
            this.clearDynamicColors();

            return;
        }

        try {
            const diagnostic = CoreNative.plugin('diagnostic');
            if (!diagnostic) {
                return;
            }

            const systemColors = await diagnostic.getSystemColors();
            if (!systemColors || Object.keys(systemColors).length === 0) {
                return;
            }

            const isDarkMode = this.isDarkModeEnabled();

            // Pick base colors based on light/dark mode
            const primary = isDarkMode
                ? (systemColors.system_accent1_200 || systemColors.system_accent1_300 || '#90CAF9')
                : (systemColors.system_accent1_600 || systemColors.system_accent1_500 || '#1976D2');

            const secondary = isDarkMode
                ? (systemColors.system_accent2_200 || systemColors.system_accent2_300 || '#80CBC4')
                : (systemColors.system_accent2_600 || systemColors.system_accent2_500 || '#00796B');

            const background = isDarkMode
                ? (systemColors.system_neutral1_900 || '#121212')
                : (systemColors.system_neutral1_10 || systemColors.system_neutral1_50 || '#FEF7FF');

            const text = isDarkMode
                ? (systemColors.system_neutral1_50 || '#E6E1E5')
                : (systemColors.system_neutral1_900 || '#1D1B20');

            const surface = isDarkMode
                ? (systemColors.system_neutral1_800 || '#1E1E1E')
                : (systemColors.system_neutral2_50 || '#FFFFFF');

            // Apply base color properties and Ionic variants (shade, tint, contrast, rgb)
            this.setCSSColorProperty('primary', primary);
            this.setCSSColorProperty('secondary', secondary);

            const root = document.documentElement.style;
            root.setProperty('--background-color', background);
            root.setProperty('--text-color', text);
            root.setProperty('--ion-item-background', surface);
            root.setProperty('--stroke', isDarkMode
                ? (systemColors.system_neutral2_700 || '#49454F')
                : (systemColors.system_neutral2_300 || '#CAC4D0'));

            // Generate background step-colors and text step-colors
            for (let i = 50; i <= 950; i += 50) {
                const percent = i / 1000;
                const mixedBg = this.mixColors(text, background, percent * 100);
                const mixedText = this.mixColors(background, text, percent * 100);

                root.setProperty(`--ion-background-color-step-${i}`, mixedBg);
                root.setProperty(`--ion-text-color-step-${i}`, mixedText);
            }

            // Harmonize custom gray variables
            if (systemColors.system_neutral2_100) {
                root.setProperty('--gray-100', isDarkMode ? systemColors.system_neutral2_800 : systemColors.system_neutral2_100);
                root.setProperty('--gray-200', isDarkMode ? systemColors.system_neutral2_700 : systemColors.system_neutral2_200);
                root.setProperty('--gray-300', isDarkMode ? systemColors.system_neutral2_600 : systemColors.system_neutral2_300);
                root.setProperty('--gray-500', isDarkMode ? systemColors.system_neutral2_400 : systemColors.system_neutral2_500);
                root.setProperty('--gray-700', isDarkMode ? systemColors.system_neutral2_200 : systemColors.system_neutral2_700);
                root.setProperty('--gray-900', isDarkMode ? systemColors.system_neutral2_100 : systemColors.system_neutral2_900);
            }

            CoreApp.setSystemUIColors();
        } catch (error) {
            console.error('Failed to apply dynamic colors', error);
        }
    }

    /**
     * Helper to set CSS variables for an Ionic color.
     */
    protected setCSSColorProperty(name: string, hex: string): void {
        const rgb = this.hexToRgb(hex);
        const contrast = this.getContrastColor(hex);
        const contrastRgb = this.hexToRgb(contrast);
        const shade = this.mixColors('#000000', hex, 48); // 48% black
        const tint = this.mixColors('#ffffff', hex, 80); // 80% white

        const root = document.documentElement.style;
        root.setProperty(`--${name}`, hex);
        root.setProperty(`--${name}-shade`, shade);
        root.setProperty(`--${name}-tint`, tint);
        root.setProperty(`--${name}-contrast`, contrast);

        root.setProperty(`--ion-color-${name}`, `var(--${name})`);
        root.setProperty(`--ion-color-${name}-base`, `var(--ion-color-${name})`);
        root.setProperty(`--ion-color-${name}-rgb`, `${rgb.r}, ${rgb.g}, ${rgb.b}`);
        root.setProperty(`--ion-color-${name}-contrast`, contrast);
        root.setProperty(`--ion-color-${name}-contrast-rgb`, `${contrastRgb.r}, ${contrastRgb.g}, ${contrastRgb.b}`);
        root.setProperty(`--ion-color-${name}-shade`, shade);
        root.setProperty(`--ion-color-${name}-tint`, tint);
    }

    /**
     * Clears dynamically applied CSS custom properties.
     */
    clearDynamicColors(): void {
        const root = document.documentElement.style;
        const propertiesToRemove = [
            '--primary', '--primary-shade', '--primary-tint', '--primary-contrast',
            '--secondary', '--secondary-shade', '--secondary-tint', '--secondary-contrast',
            '--background-color', '--text-color', '--ion-item-background', '--stroke',
            '--gray-100', '--gray-200', '--gray-300', '--gray-500', '--gray-700', '--gray-900',
            '--ion-color-primary', '--ion-color-primary-base', '--ion-color-primary-rgb',
            '--ion-color-primary-contrast', '--ion-color-primary-contrast-rgb',
            '--ion-color-primary-shade', '--ion-color-primary-tint',
            '--ion-color-secondary', '--ion-color-secondary-base', '--ion-color-secondary-rgb',
            '--ion-color-secondary-contrast', '--ion-color-secondary-contrast-rgb',
            '--ion-color-secondary-shade', '--ion-color-secondary-tint',
        ];

        propertiesToRemove.forEach((prop) => root.removeProperty(prop));

        for (let i = 50; i <= 950; i += 50) {
            root.removeProperty(`--ion-background-color-step-${i}`);
            root.removeProperty(`--ion-text-color-step-${i}`);
        }

        CoreApp.setSystemUIColors();
    }

    /**
     * Mixes two hex colors by weight percentage.
     */
    protected mixColors(color1: string, color2: string, weight: number): string {
        const c1 = this.hexToRgb(color1);
        const c2 = this.hexToRgb(color2);

        const w = weight / 100;
        const r = Math.round(c1.r * w + c2.r * (1 - w));
        const g = Math.round(c1.g * w + c2.g * (1 - w));
        const b = Math.round(c1.b * w + c2.b * (1 - w));

        return this.rgbToHex(r, g, b);
    }

    protected hexToRgb(hex: string): { r: number; g: number; b: number } {
        const cleanHex = hex.replace('#', '');
        const num = parseInt(cleanHex.length === 3
            ? cleanHex.split('').map((c) => c + c).join('')
            : cleanHex, 16);

        return {
            r: (num >> 16) & 255,
            g: (num >> 8) & 255,
            b: num & 255,
        };
    }

    protected rgbToHex(r: number, g: number, b: number): string {
        const clamp = (v: number) => Math.max(0, Math.min(255, v));

        return '#' + [clamp(r), clamp(g), clamp(b)].map((x) => {
            const h = x.toString(16);

            return h.length === 1 ? '0' + h : h;
        }).join('');
    }

    /**
     * WCAG contrast color calculation (returns '#ffffff' or '#000000').
     */
    protected getContrastColor(hexColor: string): string {
        const componentLuminance = (val: number) => {
            const v = val / 255;

            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        };
        const rgb = this.hexToRgb(hexColor);
        const r = componentLuminance(rgb.r);
        const g = componentLuminance(rgb.g);
        const b = componentLuminance(rgb.b);
        const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;

        const whiteContrast = (luminance + 0.05) / 1.05;
        const blackContrast = 0.05 / (luminance + 0.05);

        return whiteContrast < blackContrast ? '#ffffff' : '#000000';
    }

    /**
     * Returns dark mode change observable.
     *
     * @returns Dark mode change observable.
     */
    onDarkModeChange(): Observable<boolean> {
        return this.darkModeObservable;
    }

    /**
     * Get if user enabled staging sites or not.
     *
     * @returns Staging sites.
     */
    async hasEnabledStagingSites(): Promise<boolean> {
        const staging = await CoreConfig.get<number>('stagingSites', 0);

        return !!staging;
    }

    /**
     * Persist staging sites enabled status and refresh app to apply changes.
     *
     * @param enabled Enabled or disabled staging sites.
     */
    async setEnabledStagingSites(enabled: boolean): Promise<void> {
        const reloadApp = !CoreSites.isLoggedIn();

        if (reloadApp) {
            await CoreAlerts.confirm('Are you sure that you want to enable/disable staging sites?');
        }

        await CoreConfig.set('stagingSites', enabled ? 1 : 0);

        if (!reloadApp) {
            return;
        }

        await CoreNavigator.navigate('/');
        window.location.reload();
    }

    /**
     * Get extra pages items to display in the developer settings page.
     *
     * @returns Extra items.
     */
    getDevExtraPageItems(): CoreSettingsHelperDevExtraPageItem[] {
        return [];
    }

}

export const CoreSettingsHelper = makeSingleton(CoreSettingsHelperProvider);

/**
 * Data to display extra links to new pages in the developer settings page.
 */
export type CoreSettingsHelperDevExtraPageItem = {
    /**
     * Title to display. Dev page titles usually aren't translated.
     */
    title: string;

    /**
     * Class to add to the displayed item.
     */
    class?: string;

    /**
     * Relative path of the page to load when clicked.
     */
    page: string;

    /**
     * Params to pass to the page.
     */
    pageParams?: Params;
};
