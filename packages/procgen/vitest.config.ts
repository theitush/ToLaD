import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['test/**/*.test.ts'],
          exclude: ['test/**/*.browser.test.ts'],
        },
      },
      {
        test: {
          name: 'browser',
          include: ['test/**/*.test.ts'],
          // the lint test reads source files from disk (Node only)
          exclude: ['test/lint.test.ts'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [
              {
                browser: 'chromium',
                provider: playwright({
                  launchOptions: {
                    // WebGL2 in headless Chromium runs on SwiftShader (CPU)
                    args: ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
                  },
                }),
              },
              // a second JS engine (SpiderMonkey) for cross-engine golden checks
              { browser: 'firefox' },
            ],
          },
        },
      },
    ],
  },
});
