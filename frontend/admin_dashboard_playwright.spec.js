// admin_dashboard_playwright.spec.js
// Playwright validation for TripSetGo Admin Dashboard
import { test, expect } from '@playwright/test';
import path from 'path';

const artifactsDir = 'C:/Users/ASUS/.gemini/antigravity-ide/brain/c63e375c-42f5-49c0-8860-91c514e7f45c';

// Helper for client-side navigation to the Admin Dashboard
async function navigateToAdminDashboard(page) {
  const hamburger = page.locator('button[aria-label="Toggle menu"]');
  if (await hamburger.isVisible()) {
    console.log('🍔 Hamburger menu is visible. Clicking it to reveal sidebar...');
    await hamburger.click();
    await page.waitForTimeout(500);
  }
  console.log('👑 Clicking Admin Console link...');
  await page.waitForSelector('a[href="/dashboard/admin"]');
  await page.$eval('a[href="/dashboard/admin"]', el => el.click());
  await page.waitForURL('**/dashboard/admin');
  await page.waitForTimeout(2000); // Wait for API loading states
}

test.describe('TripSetGo Admin Dashboard Validation', () => {

  test.beforeEach(async ({ page }) => {
    page.on('console', msg => console.log(`[BROWSER CONSOLE] [${msg.type()}] ${msg.text()}`));
    page.on('pageerror', err => console.error('[BROWSER EXCEPTION]', err));

    console.log('🔑 Navigating to login...');
    await page.goto('http://localhost:3000/auth/login');
    await page.waitForSelector('input[type="email"]');

    console.log('✍ Filling credentials...');
    await page.fill('input[type="email"]', 'testuser@tripsetgo.com');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"]');

    console.log('⏳ Waiting for dashboard redirect...');
    try {
      await page.waitForURL('**/dashboard', { timeout: 10000 });
      console.log('✅ Navigated to dashboard.');
    } catch (err) {
      console.error('❌ Failed to navigate to dashboard:', err);
      throw err;
    }
  });

  test('Desktop Viewport Verification', async ({ page }) => {
    console.log('🖥 Setting Desktop viewport (1280x800)...');
    await page.setViewportSize({ width: 1280, height: 800 });

    await navigateToAdminDashboard(page);

    // Verify Admin Title and Diagnostics
    await expect(page.locator('h1:has-text("Admin")')).toBeVisible();
    await expect(page.locator('text=Worker Cluster Healthy')).toBeVisible();
    console.log('✅ Title block & diagnostic banner verified.');

    // Verify KPI cards
    await expect(page.locator('text=Total Users')).toBeVisible();
    await expect(page.locator('text=Trip Workspaces')).toBeVisible();
    await expect(page.locator('text=Database Attractions')).toBeVisible();
    await expect(page.locator('text=Est. Monthly Revenue')).toBeVisible();
    console.log('✅ KPI Stats cards verified.');

    // Verify Recharts elements
    const areaChart = page.locator('.recharts-responsive-container').first();
    await expect(areaChart).toBeVisible();
    console.log('✅ Recharts trends containers verified.');

    // Verify Queue status & Workers
    await expect(page.locator('text=BullMQ Queue status')).toBeVisible();
    await expect(page.locator('text=Active').first()).toBeVisible();
    await expect(page.locator('text=Completed').first()).toBeVisible();
    console.log('✅ Queue monitoring counters verified.');

    // Verify recent timeline reports logs
    await expect(page.locator('text=System Audit Logs')).toBeVisible();
    console.log('✅ Audit logs timeline feed verified.');

    // Verify quick action button clicks
    await expect(page.locator('button:has-text("Sync Database Indexes")')).toBeVisible();
    await page.click('button:has-text("Sync Database Indexes")');
    await page.waitForTimeout(2000); // Wait for mock success toast
    console.log('✅ Quick operational actions verified.');

    // Save verification screenshot
    const screenshotPath = path.join(artifactsDir, 'admin_dashboard_desktop_verification.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 Saved Desktop screenshot to: ${screenshotPath}`);
  });

  test('Laptop Viewport Verification', async ({ page }) => {
    console.log('💻 Setting Laptop viewport (1024x768)...');
    await page.setViewportSize({ width: 1024, height: 768 });

    await navigateToAdminDashboard(page);

    // Verify layout elements are visible
    await expect(page.locator('h1:has-text("Admin")')).toBeVisible();
    await expect(page.locator('text=Total Users')).toBeVisible();
    await expect(page.locator('text=Worker Cluster Healthy')).toBeVisible();

    // Save verification screenshot
    const screenshotPath = path.join(artifactsDir, 'admin_dashboard_laptop_verification.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 Saved Laptop screenshot to: ${screenshotPath}`);
  });

  test('Tablet Viewport Verification', async ({ page }) => {
    console.log('📟 Setting Tablet viewport (768x1024)...');
    await page.setViewportSize({ width: 768, height: 1024 });

    await navigateToAdminDashboard(page);

    // Verify layout elements are visible
    await expect(page.locator('h1:has-text("Admin")')).toBeVisible();
    await expect(page.locator('text=Total Users')).toBeVisible();

    // Save verification screenshot
    const screenshotPath = path.join(artifactsDir, 'admin_dashboard_tablet_verification.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`📸 Saved Tablet screenshot to: ${screenshotPath}`);
  });

});
