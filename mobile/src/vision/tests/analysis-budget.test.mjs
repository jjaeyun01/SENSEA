import test from "node:test";
import assert from "node:assert/strict";
import { AnalysisBudget } from "../analysis-budget.mjs";
const frame=(at,ms=200)=>({receivedAt:at,processedMs:ms,quality:{status:"usable"}});
const ready=g=>{g.observe(frame(0),0);g.observe(frame(200),200);assert.equal(g.observe(frame(400),400),true);};
test("the extra model waits for three fresh fast base results",()=>{const g=new AnalysisBudget();assert.equal(g.tick(0),false);assert.equal(g.observe(frame(0),0),false);assert.equal(g.observe(frame(200),200),false);assert.equal(g.observe(frame(400),400),true);});
test("one slow base result pauses the extra model, then requires recovery and a ten-second holdoff",()=>{const g=new AnalysisBudget();ready(g);assert.equal(g.observe(frame(600,700),600),false);for(let at=800;at<10600;at+=200)assert.equal(g.observe(frame(at),at),false);assert.equal(g.observe(frame(10600),10600),true);});
test("dropped base results pause the extra model without waiting for the analysis stop",()=>{const g=new AnalysisBudget();ready(g);assert.equal(g.tick(1400),true);assert.equal(g.tick(1401),false);});
test("duplicate, stale, sparse or invalid samples cannot manufacture startup evidence",()=>{
 const g=new AnalysisBudget();for(let i=0;i<100;i++)assert.equal(g.observe(frame(0),0),false);
 g.reset();for(const at of [0,2000,4000])assert.equal(g.observe(frame(at),at),false);
 g.reset();for(const v of [frame(-2000),frame(100),frame(0,NaN),frame(1,-1)])assert.equal(g.observe(v,0),false);
});
test("retake images and reset keep the optional model off",()=>{const g=new AnalysisBudget();for(const at of [0,200,400])assert.equal(g.observe({...frame(at),quality:{status:"retake"}},at),false);g.reset();ready(g);g.reset();assert.equal(g.tick(600),false);});
