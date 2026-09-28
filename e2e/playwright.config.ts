import { defineConfig } from '@playwright/test'
import path from 'node:path'
export default defineConfig({testDir:'./tests',workers:1,retries:0,timeout:60000,
  use:{baseURL:'http://localhost:5173',browserName:'chromium',channel:process.env.E2E_BROWSER_CHANNEL || undefined,screenshot:'only-on-failure'},
  webServer:[
    {command:`"${process.env.DEALBATTLE_PYTHON || (process.platform==='win32'?'..\\.venv\\Scripts\\python.exe':'../.venv/bin/python')}" ../scripts/e2e_server.py`,url:'http://127.0.0.1:8000/health',reuseExistingServer:false,timeout:30000},
    {command:'npm --prefix ../frontend run dev -- --host localhost',url:'http://localhost:5173',reuseExistingServer:false,timeout:30000}
  ]})
