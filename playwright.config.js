import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir:'./tests',
  testMatch:'*.spec.js',
  workers:1,
  use:{baseURL:'http://127.0.0.1:3010',launchOptions:process.env.CHROMIUM_PATH?
    {executablePath:process.env.CHROMIUM_PATH,args:['--no-sandbox']}:{}},
  webServer:{command:'node backend/server.js',url:'http://127.0.0.1:3010/api/health',
    env:{PORT:'3010',MONGODB_URI:process.env.TEST_MONGODB_URI??'mongodb://127.0.0.1:27017',
      MONGODB_DB:'ev_optigrid_browser_test'},timeout:30000}
});
