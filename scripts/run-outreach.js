import { runOutreachPipeline } from '../src/outreach.js';
import dotenv from 'dotenv';
dotenv.config();

console.log('Starting outreach pipeline...');
const result = await runOutreachPipeline();
console.log('Result:', JSON.stringify(result, null, 2));
