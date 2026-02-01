import projectData from '@/data/projects.json';

type Task = {
  text: string;
  done: boolean;
};

type Link = {
  label: string;
  url: string;
};

type Project = {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  progress: number;
  tasks: Task[];
  blockers: string[];
  links?: Link[];
  lastUpdated: string;
};

type Column = {
  id: string;
  title: string;
  color: string;
};

type PendingReview = {
  repo: string;
  pr: number;
  title: string;
  url: string;
};

type BlockerSummary = {
  project: string;
  blocker: string;
};

const priorityColors: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-gray-400',
};

const columnColors: Record<string, string> = {
  blue: 'border-blue-500',
  red: 'border-red-500',
  gray: 'border-gray-500',
  green: 'border-green-500',
};

const columnBgColors: Record<string, string> = {
  blue: 'bg-blue-500/10',
  red: 'bg-red-500/10',
  gray: 'bg-gray-500/10',
  green: 'bg-green-500/10',
};

function formatTimePST(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }) + ' PST';
}

function AgentStatusWidget({ agent }: { agent: typeof projectData.agentStatus }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-bold text-white flex items-center gap-2">
          🤖 {agent.name}
          <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
        </h3>
        <span className="text-xs text-gray-500">{agent.model}</span>
      </div>
      <div className="text-sm text-gray-400 mb-3">
        <span className="text-gray-500">Current:</span> {agent.currentTask}
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-500">Session</div>
          <div className="text-blue-400 font-bold">{agent.usage.session}</div>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-500">Week (All)</div>
          <div className="text-yellow-400 font-bold">{agent.usage.weekAll}</div>
        </div>
        <div className="bg-gray-800 rounded p-2">
          <div className="text-gray-500">Sonnet</div>
          <div className="text-green-400 font-bold">{agent.usage.weekSonnet}</div>
        </div>
      </div>
      <div className="text-xs text-gray-500 mt-2">Resets: {agent.usage.resetsAt}</div>
    </div>
  );
}

function BlockersWidget({ blockers }: { blockers: BlockerSummary[] }) {
  if (blockers.length === 0) return null;
  
  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4">
      <h3 className="font-bold text-red-400 mb-3 flex items-center gap-2">
        ⚠️ Blockers Requiring Action ({blockers.length})
      </h3>
      <div className="space-y-2">
        {blockers.map((b, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="text-red-400 shrink-0">•</span>
            <span className="text-gray-300">
              <span className="text-red-300 font-medium">{b.project}:</span> {b.blocker}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PendingReviewsWidget({ reviews }: { reviews: PendingReview[] }) {
  if (reviews.length === 0) return null;
  
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <h3 className="font-bold text-white mb-3 flex items-center gap-2">
        📝 Pending PR Reviews ({reviews.length})
      </h3>
      <div className="space-y-2">
        {reviews.map((pr, i) => (
          <a
            key={i}
            href={pr.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-2 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
          >
            <div className="text-sm">
              <span className="text-purple-400">#{pr.pr}</span>
              <span className="text-gray-400 mx-2">·</span>
              <span className="text-gray-300">{pr.title}</span>
            </div>
            <span className="text-xs text-gray-500">{pr.repo} ↗</span>
          </a>
        ))}
      </div>
    </div>
  );
}

function CronsWidget({ crons }: { crons: typeof projectData.crons }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <h3 className="font-bold text-white mb-3">⏰ Automated Jobs</h3>
      <div className="space-y-2">
        {crons.map((cron, i) => (
          <div key={i} className="flex items-center justify-between p-2 bg-gray-800 rounded text-sm">
            <div>
              <span className="text-gray-300">{cron.name}</span>
              <span className="text-gray-500 text-xs ml-2">({cron.model})</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500 text-xs">{cron.schedule}</span>
              <span className={`w-2 h-2 rounded-full ${cron.status === 'active' ? 'bg-green-500' : 'bg-red-500'}`} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function CampaignsWidget({ campaigns }: { campaigns: typeof projectData.campaigns }) {
  return (
    <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
      <h3 className="font-bold text-white mb-3">📧 Active Campaigns</h3>
      <div className="space-y-3">
        {Object.entries(campaigns).map(([key, campaign]) => (
          <div key={key} className="p-2 bg-gray-800 rounded">
            <div className="text-sm text-gray-300 font-medium mb-2">{campaign.name}</div>
            <div className="grid grid-cols-4 gap-2 text-xs">
              <div>
                <div className="text-gray-500">Sent</div>
                <div className="text-white font-bold">{campaign.sent}</div>
              </div>
              <div>
                <div className="text-gray-500">Delivered</div>
                <div className="text-green-400">{campaign.delivered}</div>
              </div>
              <div>
                <div className="text-gray-500">Opened</div>
                <div className="text-yellow-400">{campaign.opened}</div>
              </div>
              <div>
                <div className="text-gray-500">Replied</div>
                <div className="text-blue-400">{campaign.replied}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DeploymentsWidget({ deployments }: { deployments: typeof projectData.deployments }) {
  const statusColors: Record<string, string> = {
    ready: 'bg-green-500',
    error: 'bg-red-500',
    building: 'bg-yellow-500',
    unknown: 'bg-gray-500',
  };

  const hasErrors = deployments.some(d => d.status === 'error');

  return (
    <div className={`bg-gray-900 rounded-lg p-4 border ${hasErrors ? 'border-red-500' : 'border-gray-800'}`}>
      <h3 className="font-bold text-white mb-3 flex items-center gap-2">
        🚀 Vercel Deployments
        {hasErrors && <span className="text-red-400 text-xs">⚠️ Errors</span>}
      </h3>
      <div className="space-y-2">
        {deployments.map((deploy, i) => (
          <a
            key={i}
            href={deploy.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between p-2 bg-gray-800 rounded hover:bg-gray-700 transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${statusColors[deploy.status]}`} />
              <span className="text-sm text-gray-300">{deploy.project}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-gray-500">
              <span>{deploy.env}</span>
              <span>·</span>
              <span>{deploy.age}</span>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function AlertsWidget({ alerts }: { alerts: typeof projectData.alerts }) {
  if (alerts.length === 0) return null;
  
  const alertColors: Record<string, string> = {
    info: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
    warning: 'bg-yellow-500/10 border-yellow-500/30 text-yellow-300',
    error: 'bg-red-500/10 border-red-500/30 text-red-300',
  };

  return (
    <div className="space-y-2">
      {alerts.map((alert, i) => (
        <div key={i} className={`rounded-lg p-3 border text-sm ${alertColors[alert.type]}`}>
          {alert.message}
          <span className="text-xs opacity-60 ml-2">{formatTimePST(alert.time)}</span>
        </div>
      ))}
    </div>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const completedTasks = project.tasks.filter(t => t.done).length;
  const totalTasks = project.tasks.length;
  const hasBlockers = project.blockers.length > 0;

  return (
    <div className={`bg-gray-800 rounded-lg p-4 shadow-lg border-l-4 ${hasBlockers ? 'border-red-500' : 'border-gray-700'}`}>
      <div className="flex items-start justify-between mb-2">
        <h3 className="font-semibold text-white text-lg">{project.title}</h3>
        <span className={`px-2 py-0.5 rounded text-xs font-medium text-white ${priorityColors[project.priority]}`}>
          {project.priority}
        </span>
      </div>
      
      <p className="text-gray-400 text-sm mb-3">{project.description}</p>
      
      {/* Progress bar */}
      <div className="mb-3">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Progress</span>
          <span>{project.progress}%</span>
        </div>
        <div className="h-2 bg-gray-700 rounded-full overflow-hidden">
          <div 
            className="h-full bg-blue-500 rounded-full transition-all"
            style={{ width: `${project.progress}%` }}
          />
        </div>
      </div>

      {/* Tasks */}
      {totalTasks > 0 && (
        <div className="mb-3">
          <div className="text-xs text-gray-500 mb-1">
            Tasks: {completedTasks}/{totalTasks}
          </div>
          <div className="space-y-1 max-h-32 overflow-y-auto">
            {project.tasks.slice(0, 5).map((task, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <span className={task.done ? 'text-green-400' : 'text-gray-500'}>
                  {task.done ? '✓' : '○'}
                </span>
                <span className={task.done ? 'text-gray-500 line-through' : 'text-gray-300'}>
                  {task.text}
                </span>
              </div>
            ))}
            {project.tasks.length > 5 && (
              <div className="text-xs text-gray-500">+{project.tasks.length - 5} more</div>
            )}
          </div>
        </div>
      )}

      {/* Blockers */}
      {hasBlockers && (
        <div className="mb-3 p-2 bg-red-500/10 rounded border border-red-500/30">
          <div className="text-xs text-red-400 font-medium mb-1">⚠️ Blockers</div>
          <ul className="text-xs text-red-300 space-y-1">
            {project.blockers.map((blocker, i) => (
              <li key={i}>• {blocker}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Links */}
      {project.links && project.links.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {project.links.map((link, i) => (
            <a
              key={i}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-400 hover:text-blue-300 hover:underline"
            >
              {link.label} ↗
            </a>
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="text-xs text-gray-500 pt-2 border-t border-gray-700">
        Updated {formatTimePST(project.lastUpdated)}
      </div>
    </div>
  );
}

function KanbanColumn({ column, projects }: { column: Column; projects: Project[] }) {
  return (
    <div className={`flex-1 min-w-[280px] max-w-[350px]`}>
      <div className={`rounded-t-lg p-3 ${columnBgColors[column.color]} border-b-2 ${columnColors[column.color]}`}>
        <h2 className="font-bold text-white flex items-center gap-2">
          {column.title}
          <span className="bg-gray-700 text-gray-300 text-xs px-2 py-0.5 rounded-full">
            {projects.length}
          </span>
        </h2>
      </div>
      <div className="bg-gray-900/50 rounded-b-lg p-3 space-y-3 min-h-[200px]">
        {projects.map(project => (
          <ProjectCard key={project.id} project={project} />
        ))}
        {projects.length === 0 && (
          <div className="text-gray-600 text-sm text-center py-8">
            No projects
          </div>
        )}
      </div>
    </div>
  );
}

export default function Home() {
  const { 
    columns, 
    projects, 
    recentActivity, 
    lastUpdated,
    agentStatus,
    alerts,
    blockersSummary,
    pendingReviews,
    crons,
    campaigns,
    deployments
  } = projectData;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      {/* Header */}
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-4">
        <div className="max-w-[1600px] mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold">🎯 Mission Control</h1>
            <p className="text-gray-400 text-sm">Project dashboard for Shibley + AI</p>
          </div>
          <div className="text-right">
            <div className="text-xs text-gray-500">Last sync</div>
            <div className="text-sm text-gray-300">{formatTimePST(lastUpdated)}</div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="max-w-[1600px] mx-auto px-6 py-6">
        {/* Alerts */}
        <AlertsWidget alerts={alerts} />

        {/* Top widgets row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mt-4 mb-6">
          <AgentStatusWidget agent={agentStatus} />
          <BlockersWidget blockers={blockersSummary} />
          <PendingReviewsWidget reviews={pendingReviews} />
        </div>

        {/* Second widgets row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <DeploymentsWidget deployments={deployments} />
          <CronsWidget crons={crons} />
          <CampaignsWidget campaigns={campaigns} />
        </div>

        {/* Kanban board */}
        <div className="mb-6">
          <h2 className="font-bold text-lg mb-3">📊 Projects</h2>
          <div className="flex gap-4 overflow-x-auto pb-4">
            {columns.map(column => (
              <KanbanColumn
                key={column.id}
                column={column}
                projects={projects.filter(p => p.status === column.id)}
              />
            ))}
          </div>
        </div>

        {/* Recent Activity */}
        <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
          <h2 className="font-bold text-lg mb-3">📜 Recent Activity</h2>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {recentActivity.slice(0, 15).map((activity, i) => (
              <div key={i} className="flex items-start gap-3 text-sm">
                <span className="text-gray-500 text-xs w-16 shrink-0">
                  {formatTimePST(activity.time)}
                </span>
                <span className="text-gray-300">{activity.text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Stats */}
        <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="text-2xl font-bold text-blue-400">
              {projects.filter(p => p.status === 'active').length}
            </div>
            <div className="text-gray-500 text-sm">Active Projects</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="text-2xl font-bold text-red-400">
              {blockersSummary.length}
            </div>
            <div className="text-gray-500 text-sm">Total Blockers</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="text-2xl font-bold text-green-400">
              {projects.reduce((acc, p) => acc + p.tasks.filter(t => t.done).length, 0)}
            </div>
            <div className="text-gray-500 text-sm">Tasks Completed</div>
          </div>
          <div className="bg-gray-900 rounded-lg p-4 border border-gray-800">
            <div className="text-2xl font-bold text-yellow-400">
              {projects.reduce((acc, p) => acc + p.tasks.filter(t => !t.done).length, 0)}
            </div>
            <div className="text-gray-500 text-sm">Tasks Remaining</div>
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-gray-800 px-6 py-4 mt-8">
        <div className="max-w-[1600px] mx-auto text-center text-gray-500 text-sm">
          Mission Control v1.0 • Auto-updated by AI
        </div>
      </footer>
    </div>
  );
}
