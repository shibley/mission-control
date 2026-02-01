#!/usr/bin/env node
/**
 * Sync mission-control dashboard from memory/mission-control.md
 * Parses markdown → generates src/data/projects.json
 */

const fs = require('fs');
const path = require('path');

const MEMORY_FILE = path.join(__dirname, '../../../memory/mission-control.md');
const OUTPUT_FILE = path.join(__dirname, '../src/data/projects.json');

function parseMarkdown(content) {
  const data = {
    lastUpdated: new Date().toISOString(),
    agentStatus: {
      name: "AI Assistant",
      status: "online",
      currentTask: "Autonomous mode - monitoring & building",
      model: "Claude Sonnet 4.5",
      usage: {
        session: "~18%",
        weekAll: "~23%",
        weekSonnet: "23%",
        resetsAt: "Feb 5, 2026"
      }
    },
    deployments: [],
    alerts: [],
    blockersSummary: [],
    pendingReviews: [],
    crons: [
      { name: "API Outage Monitor", schedule: "Every 5 min", model: "Haiku", status: "active" },
      { name: "Morning Brief", schedule: "7:00 AM PST", model: "Opus", status: "active" },
      { name: "Afternoon Report", schedule: "2:00 PM PST", model: "Opus", status: "active" },
      { name: "Nightly Build", schedule: "11:00 PM PST", model: "Codex/Opus", status: "active" },
      { name: "SOC 2 Outreach", schedule: "6:00 AM PST", model: "Haiku", status: "paused" }
    ],
    campaigns: {},
    columns: [
      { id: "active", title: "🔄 Active", color: "blue" },
      { id: "blocked", title: "🚫 Blocked", color: "red" },
      { id: "paused", title: "⏸️ Paused", color: "gray" },
      { id: "done", title: "✅ Done", color: "green" }
    ],
    projects: [],
    recentActivity: []
  };

  // Parse Autonomous Work Log for recent activity
  const workLogMatch = content.match(/## 📋 Autonomous Work Log\n\n### (.+?)\n\n([\s\S]*?)(?=\n---|\n##|$)/);
  if (workLogMatch) {
    const logContent = workLogMatch[2];
    const entries = logContent.match(/\*\*(\d{2}:\d{2} PST) - (.+?)\*\*\n([\s\S]*?)(?=\n\*\*|\n###|$)/g);
    
    if (entries) {
      entries.forEach(entry => {
        const match = entry.match(/\*\*(\d{2}:\d{2} PST) - (.+?)\*\*\n([\s\S]*?)$/);
        if (match) {
          const [, time, action, details] = match;
          const lines = details.trim().split('\n').filter(l => l.trim().startsWith('-'));
          const summary = lines.map(l => l.replace(/^-\s*/, '').trim()).join('; ');
          
          data.recentActivity.push({
            time: new Date().toISOString(), // Approximate - could parse better
            text: `${action}: ${summary}`
          });
        }
      });
    }
  }

  // Parse projects from Active Focus section
  const projects = [];
  
  // API Status Check
  const apiStatusMatch = content.match(/### API Status Check — SEO & Growth([\s\S]*?)(?=\n### |$)/);
  if (apiStatusMatch) {
    const section = apiStatusMatch[1];
    const tasks = [];
    const taskMatches = section.matchAll(/- \[(x| )\] (.+)/g);
    for (const match of taskMatches) {
      tasks.push({
        text: match[2].replace(/\*\*|\✅/g, '').trim(),
        done: match[1] === 'x'
      });
    }
    
    const isBlocked = section.includes('BLOCKED');
    const blockers = [];
    const blockerMatch = section.match(/\*\*BLOCKER:\*\* (.+)/);
    if (blockerMatch) blockers.push(blockerMatch[1]);
    
    projects.push({
      id: "apistatuscheck",
      title: "API Status Check",
      description: "Real-time monitoring for 100 APIs, SEO-driven growth",
      status: isBlocked ? "blocked" : "active",
      priority: "high",
      progress: Math.round((tasks.filter(t => t.done).length / tasks.length) * 100) || 95,
      tasks: tasks.slice(0, 15),
      blockers,
      links: [
        { label: "Live Site", url: "https://apistatuscheck.com" },
        { label: "GitHub", url: "https://github.com/shibley/apistatuscheck" }
      ],
      lastUpdated: new Date().toISOString()
    });
  }

  // BityClips
  const bityMatch = content.match(/### BityClips Revival 🎬([\s\S]*?)(?=\n### |$)/);
  if (bityMatch) {
    const section = bityMatch[1];
    const tasks = [];
    const taskMatches = section.matchAll(/- \[(x| )\] (.+)/g);
    for (const match of taskMatches) {
      tasks.push({
        text: match[2].replace(/\*\*|\⚠️/g, '').trim(),
        done: match[1] === 'x'
      });
    }
    
    const isBlocked = section.includes('BLOCKED');
    const blockers = [];
    const blockerMatch = section.match(/\*\*BLOCKER:\*\* (.+)/);
    if (blockerMatch) blockers.push(blockerMatch[1]);
    
    if (isBlocked) {
      data.blockersSummary.push({
        project: "BityClips",
        blocker: blockers[0] || "Video generation verification needed"
      });
    }
    
    projects.push({
      id: "bityclips",
      title: "BityClips",
      description: "AI video generation SaaS - fixing + relaunching",
      status: isBlocked ? "blocked" : "active",
      priority: "medium",
      progress: Math.round((tasks.filter(t => t.done).length / tasks.length) * 100) || 85,
      tasks: tasks.slice(0, 15),
      blockers,
      links: [
        { label: "Live Site", url: "https://bityclips.com" },
        { label: "GitHub", url: "https://github.com/shibley/Bityclips" }
      ],
      lastUpdated: new Date().toISOString()
    });
  }

  // API Subs
  const apiSubsMatch = content.match(/### API Subs — COMPLETE & READY TO LAUNCH([\s\S]*?)(?=\n### |$)/);
  if (apiSubsMatch) {
    const section = apiSubsMatch[1];
    const tasks = [];
    const taskMatches = section.matchAll(/- \[(x| )\] (.+)/g);
    for (const match of taskMatches) {
      tasks.push({
        text: match[2].replace(/\*\*|🎉/g, '').trim(),
        done: match[1] === 'x'
      });
    }
    
    projects.push({
      id: "apisubs",
      title: "API Subs",
      description: "20 zero-maintenance APIs, ready for Product Hunt Feb 19",
      status: "paused",
      priority: "high",
      progress: 100,
      tasks: tasks.slice(0, 15),
      blockers: [],
      links: [
        { label: "Live Site", url: "https://apisubs.vercel.app" }
      ],
      lastUpdated: new Date().toISOString()
    });
  }

  // SOC 2 Broker
  const soc2Match = content.match(/### SOC 2 Broker([\s\S]*?)(?=\n### |$)/);
  if (soc2Match) {
    const section = soc2Match[1];
    const isBlocked = section.includes('BLOCKED');
    const blockers = [];
    const blockerMatch = section.match(/\*\*BLOCKER:\*\* (.+)/);
    if (blockerMatch) {
      blockers.push(blockerMatch[1]);
      data.blockersSummary.push({
        project: "SOC 2 Broker",
        blocker: blockerMatch[1]
      });
    }
    
    projects.push({
      id: "soc2broker",
      title: "SOC 2 Broker",
      description: "Security questionnaire brokerage service",
      status: isBlocked ? "blocked" : "paused",
      priority: "low",
      progress: 40,
      tasks: [
        { text: "20 emails sent, 15 delivered", done: true },
        { text: "Add new leads to leads.json", done: false }
      ],
      blockers,
      links: [],
      lastUpdated: new Date().toISOString()
    });
  }

  // BrewDash
  const brewMatch = content.match(/### BrewDash([\s\S]*?)(?=\n### |$)/);
  if (brewMatch) {
    projects.push({
      id: "brewdash",
      title: "BrewDash",
      description: "Brewery management SaaS - paused after negative signal",
      status: "paused",
      priority: "low",
      progress: 60,
      tasks: [
        { text: "312 cold emails sent", done: true },
        { text: "1 negative reply received", done: true }
      ],
      blockers: [],
      links: [
        { label: "Landing Page", url: "https://brewdash.co" }
      ],
      lastUpdated: new Date().toISOString()
    });
  }

  data.projects = projects;

  // Add deployment status
  data.deployments = [
    { project: "apistatuscheck", url: "https://apistatuscheck.com", status: "ready", age: "Live", env: "Production" },
    { project: "apisubs", url: "https://apisubs.vercel.app", status: "ready", age: "Live", env: "Production" },
    { project: "bityclips", url: "https://bityclips.com", status: "ready", age: "Live", env: "Production" },
    { project: "brewdash", url: "https://brewdash.co", status: "ready", age: "Live", env: "Production" },
    { project: "mission-control", url: "https://mission-control-woad-five.vercel.app", status: "ready", age: "Just updated", env: "Production" }
  ];

  // Add alerts for blockers
  if (data.blockersSummary.length > 0) {
    data.alerts.push({
      type: "warning",
      message: `${data.blockersSummary.length} project(s) blocked - review needed`,
      time: new Date().toISOString()
    });
  }

  return data;
}

function main() {
  console.log('📊 Syncing mission control dashboard...');
  
  if (!fs.existsSync(MEMORY_FILE)) {
    console.error(`❌ Memory file not found: ${MEMORY_FILE}`);
    process.exit(1);
  }

  const content = fs.readFileSync(MEMORY_FILE, 'utf-8');
  const data = parseMarkdown(content);
  
  // Ensure output directory exists
  const outputDir = path.dirname(OUTPUT_FILE);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
  console.log(`✅ Updated ${OUTPUT_FILE}`);
  console.log(`📈 Projects: ${data.projects.length}`);
  console.log(`📋 Recent activity: ${data.recentActivity.length} entries`);
  console.log(`⚠️  Blockers: ${data.blockersSummary.length}`);
}

main();
