import { loadDashboardCredentials } from '../lib/local-dashboard-credentials.mjs';
import { dashboardConfig, createDashboardServer } from '../lib/dashboard-server.mjs';
import { loadTargets } from '../lib/config.mjs';
const local=process.env.DASHBOARD_CLIENT_SECRET ? {} : await loadDashboardCredentials();
const config=dashboardConfig({...local,...process.env}), origin=new URL(config.origin);
const server=createDashboardServer(config,{targets:await loadTargets()});
server.listen(Number(process.env.PORT || origin.port || 4180),process.env.DASHBOARD_BIND || '127.0.0.1',()=>console.log('Protected dashboard: '+config.origin));
