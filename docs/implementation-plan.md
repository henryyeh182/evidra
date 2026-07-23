# Fitness MCP Implementation Plan

## 1. Vision

Fitness MCP is a personal fitness intelligence platform built around a Semantic Fitness Layer.

The core idea is simple:

> ChatGPT, Claude, Gemini, Cursor, mobile apps, watches, and future AI clients should not each re-interpret raw Apple Health, Garmin, Strava, Oura, WHOOP, or workout data. They should all query the same trusted semantic layer through MCP and receive a consistent understanding of the user's fitness state.

Fitness MCP is not just a workout planner. It is an AI-native fitness operating layer that normalizes health, recovery, training, preference, equipment, calendar, nutrition, and goal data into a unified model.

## 2. Product Positioning

### Product Name

Fitness MCP

### Core Differentiator

The product exposes a model-agnostic Semantic Fitness Layer through MCP.

Instead of asking each LLM to independently analyze raw health data, Fitness MCP computes and stores durable semantic state:

- Recovery score
- Readiness score
- Training load
- Muscle fatigue
- Injury constraints
- Goal alignment
- Available training windows
- Equipment context
- Suggested workout focus
- Recommendation reasoning
- Plan adaptation decisions

This allows different AI clients to produce consistent advice because they are reading from the same semantic source of truth.

### Target Users

- Individual athletes and fitness enthusiasts
- Hybrid strength/cardio users
- Runners, cyclists, and endurance athletes
- Personal trainers and coaches
- Future third-party AI fitness apps
- LLM clients needing personalized fitness context

## 3. System Goals

### MVP Goals

- Build a working MCP server.
- Define the normalized domain model.
- Import seed data manually or from CSV/JSON.
- Support user profile, goals, preferences, injuries, equipment, and workout history.
- Generate a daily semantic fitness state.
- Provide core MCP tools for state retrieval, recommendations, and plan generation.
- Support one initial connector path, preferably Apple Health export or Strava API.

### v1.0 Goals

- Support multiple real connectors: Apple Health, Garmin, Strava, Oura, WHOOP.
- Maintain a unified fitness knowledge graph.
- Generate adaptive training plans.
- Expose stable MCP tools for ChatGPT, Claude, Gemini, Cursor, VS Code, and other MCP clients.
- Provide a web dashboard for debugging, observability, and user review.
- Add secure OAuth, consent management, audit logs, and data deletion.
- Provide production-grade testing, monitoring, and deployment.

## 4. High-Level Architecture

```text
AI Clients
  - ChatGPT
  - Claude
  - Gemini
  - Cursor
  - VS Code
  - Mobile app
  - Web dashboard
        |
        v
MCP Server
  - Tools
  - Resources
  - Prompts
  - Auth/session context
        |
        v
Application Services
  - User service
  - Connector service
  - Workout service
  - Planning service
  - Recommendation service
  - Recovery service
  - Analytics service
  - Semantic state service
        |
        v
Semantic Fitness Layer
  - Normalized user state
  - Knowledge graph
  - Training load model
  - Recovery/readiness model
  - Recommendation reasoning
        |
        v
Data Layer
  - PostgreSQL
  - TimescaleDB
  - Neo4j or Memgraph
  - pgvector or Qdrant
  - Redis
        |
        v
Connectors
  - Apple Health
  - Garmin Connect
  - Strava
  - Oura
  - WHOOP
  - Google Fit
  - TrainingPeaks
  - Calendar providers
```

## 5. Core Architecture Principles

1. LLMs orchestrate, but do not own the source of truth.
2. Connectors import raw data, but do not define product semantics.
3. The semantic layer produces normalized, explainable user state.
4. MCP exposes stable tools, not raw database tables.
5. Recommendations must be inspectable and reproducible.
6. Safety constraints, injury rules, and user preferences override generic plans.
7. The system should be model-agnostic from day one.

## 6. Domain Model

### User

Represents the person being coached.

Key fields:

- `id`
- `name`
- `timezone`
- `date_of_birth`
- `sex`
- `height_cm`
- `weight_kg`
- `fitness_level`
- `primary_goal_id`
- `created_at`
- `updated_at`

Relationships:

- User has goals
- User has preferences
- User has injuries
- User has equipment
- User has workouts
- User has health metrics
- User has semantic states
- User has plans

### Goal

Examples:

- Lose fat
- Build muscle
- Improve VO2 max
- Run half marathon
- Improve general health
- Maintain consistency
- Improve sleep and recovery

Key fields:

- `id`
- `user_id`
- `type`
- `target_value`
- `target_date`
- `priority`
- `status`

### Preference

Examples:

- Likes strength training
- Avoids burpees
- Prefers morning workouts
- Has 45 minutes on weekdays
- Prefers gym workouts
- Wants low-impact cardio

Key fields:

- `id`
- `user_id`
- `category`
- `key`
- `value`
- `strength`

### Injury / Constraint

Examples:

- Left knee pain
- Avoid jumping
- No heavy spinal loading
- Shoulder impingement

Key fields:

- `id`
- `user_id`
- `body_region`
- `severity`
- `restriction`
- `start_date`
- `status`

### Equipment

Examples:

- Dumbbell
- Barbell
- Squat rack
- Treadmill
- Stationary bike
- Pull-up bar
- Kettlebell
- Resistance band

Key fields:

- `id`
- `user_id`
- `equipment_type`
- `location`
- `availability`

### Exercise

Represents a canonical movement.

Examples:

- Squat
- Goblet squat
- Back squat
- Romanian deadlift
- Bench press
- Zone 2 run
- Recovery ride

Key fields:

- `id`
- `name`
- `aliases`
- `movement_pattern`
- `difficulty`
- `skill_level`
- `impact_level`
- `mobility_requirement`
- `risk_level`

Graph relationships:

- Exercise targets Muscle
- Exercise uses Equipment
- Exercise loads Joint
- Exercise is variant of Exercise
- Exercise progresses to Exercise
- Exercise regresses to Exercise
- Exercise substitutes for Exercise
- Exercise contraindicated by Injury

### Workout

Represents a completed, planned, or recommended workout.

Key fields:

- `id`
- `user_id`
- `source`
- `type`
- `name`
- `started_at`
- `duration_minutes`
- `intensity`
- `rpe`
- `calories`
- `distance_meters`
- `elevation_gain_meters`
- `average_heart_rate`
- `max_heart_rate`
- `training_load`
- `status`

Relationships:

- Workout contains exercise prescriptions
- Workout belongs to plan
- Workout affects muscle fatigue
- Workout contributes to training load

### Exercise Prescription

Used inside planned workouts.

Key fields:

- `id`
- `workout_id`
- `exercise_id`
- `sets`
- `reps`
- `weight`
- `duration_seconds`
- `distance_meters`
- `target_heart_rate_zone`
- `target_rpe`
- `rest_seconds`
- `tempo`

### Health Metric

Represents normalized time-series health data.

Examples:

- Sleep duration
- Sleep quality
- HRV
- Resting heart rate
- Steps
- Stress
- Body battery
- Readiness
- Weight
- Body fat

Key fields:

- `id`
- `user_id`
- `metric_type`
- `value`
- `unit`
- `start_time`
- `end_time`
- `source`
- `source_record_id`
- `confidence`

### Semantic Fitness State

This is the core product object.

Represents the computed state that AI clients should use instead of raw data.

Example:

```json
{
  "user_id": "user_123",
  "date": "2026-07-23",
  "timezone": "Asia/Taipei",
  "recovery_score": 82,
  "readiness_score": 76,
  "fatigue_score": 41,
  "sleep_quality": 88,
  "training_load_7d": 412,
  "training_load_28d": 1520,
  "muscle_fatigue": {
    "legs": 68,
    "chest": 20,
    "back": 35,
    "core": 32
  },
  "recommended_focus": "Zone 2 cardio + light mobility",
  "avoid": ["heavy lower body", "plyometrics"],
  "available_time_minutes": 45,
  "goal_alignment": {
    "primary_goal": "half_marathon",
    "score": 0.74
  },
  "reasoning": [
    "Yesterday's lower-body strength session increased leg fatigue.",
    "Sleep quality is strong, but HRV is slightly below baseline.",
    "Current weekly training load is within planned range."
  ]
}
```

Key fields:

- `id`
- `user_id`
- `state_date`
- `recovery_score`
- `readiness_score`
- `fatigue_score`
- `sleep_quality`
- `stress_score`
- `training_load_7d`
- `training_load_28d`
- `acute_chronic_workload_ratio`
- `recommended_focus`
- `avoid`
- `reasoning`
- `confidence`
- `generated_at`

### Plan

Represents a multi-week training plan.

Key fields:

- `id`
- `user_id`
- `goal_id`
- `name`
- `start_date`
- `end_date`
- `periodization_type`
- `status`
- `version`

Relationships:

- Plan contains planned workouts
- Plan adapts based on semantic state
- Plan supports version history

## 7. Database Choices

### PostgreSQL

Use for:

- Users
- Goals
- Preferences
- Injuries
- Equipment
- Workouts
- Plans
- Connector accounts
- OAuth tokens
- Audit logs

Reason:

- Strong consistency
- Mature indexing
- Transactional integrity
- Easy production operations

### TimescaleDB

Use for:

- Heart rate
- HRV
- Steps
- Sleep
- Stress
- Weight
- Training load time series

Reason:

- High-volume time-series queries
- PostgreSQL compatibility
- Efficient rollups and retention policies

### Neo4j or Memgraph

Use for:

- Exercise ontology
- Muscle graph
- Equipment graph
- Movement pattern relationships
- Injury contraindications
- Exercise substitutions
- Program logic graph

Reason:

- Fast relationship traversal
- Natural representation of exercise knowledge
- Useful for alternatives, regressions, progressions, and safety checks

### pgvector or Qdrant

Use for:

- Natural language exercise search
- Workout descriptions
- Coaching knowledge retrieval
- Plan explanation retrieval
- User notes and preference embeddings

Recommendation:

- Start with `pgvector` for MVP simplicity.
- Move to Qdrant if vector workloads become large or independent scaling is needed.

### Redis

Use for:

- MCP sessions
- Short-lived recommendation cache
- Connector sync locks
- Rate limit counters
- Background job coordination

## 8. Connector Strategy

### Connector Responsibilities

Each connector should only handle:

- Authentication
- Consent scopes
- Data sync
- Webhook ingestion, if supported
- Raw data storage
- Normalization into canonical events
- Sync health reporting

Connectors should not make coaching decisions.

### Connector Interface

```ts
interface FitnessConnector {
  provider: ConnectorProvider;
  connect(userId: string): Promise<AuthUrl>;
  exchangeToken(code: string): Promise<ConnectorAccount>;
  sync(userId: string, since?: Date): Promise<SyncResult>;
  normalize(rawEvent: unknown): Promise<NormalizedHealthEvent[]>;
  disconnect(userId: string): Promise<void>;
}
```

### Initial Connector Priority

1. Manual import / CSV / JSON seed connector
2. Strava
3. Apple Health export
4. Oura
5. WHOOP
6. Garmin
7. Google Fit
8. TrainingPeaks

### Notes By Provider

Apple Health:

- Best early path is Apple Health export or mobile app-based HealthKit sync.
- Full production support likely requires an iOS app.

Garmin:

- Garmin Health API access may require partner approval.
- MVP can support manual export or third-party sync first.

Strava:

- Good first OAuth connector.
- Strong for run, bike, swim, route, distance, pace, elevation, power, and HR.

Oura:

- Good for sleep, readiness, HRV, temperature, and recovery signals.

WHOOP:

- Good for recovery, strain, sleep, and HRV signals.

## 9. Semantic Fitness Layer

### Responsibilities

The Semantic Fitness Layer converts normalized data into useful meaning.

Inputs:

- User profile
- Goals
- Preferences
- Injuries
- Equipment
- Calendar availability
- Workout history
- Health metrics
- Exercise graph
- Training plan

Outputs:

- Daily semantic state
- Recommendation candidates
- Explanation trace
- Plan adaptations
- Risk warnings
- Training load summaries

### Processing Pipeline

```text
Raw provider data
  -> Raw event storage
  -> Normalized health events
  -> Aggregated daily metrics
  -> Training load calculations
  -> Recovery/readiness model
  -> Muscle fatigue model
  -> Constraint engine
  -> Goal alignment engine
  -> Semantic Fitness State
  -> MCP tools / dashboard / notifications
```

### Semantic State Generation

Initial rule-based approach:

- Compare HRV against personal baseline.
- Compare resting HR against personal baseline.
- Score sleep duration and sleep quality.
- Compute acute training load and chronic training load.
- Estimate muscle fatigue from recent workout content.
- Apply injury and equipment constraints.
- Apply user availability and preference constraints.
- Produce recommended training focus.
- Produce explanation trace.

Future hybrid approach:

- Rule engine for safety and deterministic constraints
- Statistical models for baselines and anomaly detection
- ML ranking for recommendation candidates
- LLM only for explanation, interaction, and plan editing

## 10. MCP Server Design

### MCP Design Principles

- Tools should be stable and high-level.
- Avoid exposing raw internal tables as tools.
- Return structured JSON with explainable reasoning.
- Separate read tools from write tools.
- Require explicit confirmation for destructive or scheduling actions.
- Keep client behavior model-agnostic.

### Core MCP Tools

#### User Tools

```ts
get_user_profile(user_id)
update_user_profile(user_id, patch)
get_user_goals(user_id)
update_user_goal(user_id, goal_patch)
get_user_preferences(user_id)
update_user_preferences(user_id, preferences_patch)
```

#### Semantic State Tools

```ts
get_semantic_fitness_state(user_id, date?)
get_readiness_summary(user_id, date_range?)
get_training_context(user_id, date?)
explain_today_recommendation(user_id, date?)
```

#### Workout Tools

```ts
search_exercises(query, filters?)
get_exercise(exercise_id)
search_workouts(query, filters?)
get_workout(workout_id)
log_workout(user_id, workout_payload)
```

#### Recommendation Tools

```ts
recommend_today_workout(user_id, constraints?)
recommend_workout_alternatives(user_id, workout_id, reason?)
recommend_recovery(user_id, date?)
recommend_next_best_action(user_id)
```

#### Planning Tools

```ts
generate_training_plan(user_id, goal_id, constraints?)
get_training_plan(user_id, plan_id)
adapt_training_plan(user_id, plan_id, reason, constraints?)
preview_plan_change(user_id, plan_id, change_request)
commit_plan_change(user_id, plan_id, preview_id)
```

#### Analytics Tools

```ts
get_weekly_summary(user_id, week_start?)
get_monthly_progress(user_id, month?)
get_training_load(user_id, date_range?)
get_muscle_fatigue(user_id, date?)
```

#### Connector Tools

```ts
list_connectors(user_id)
get_connector_status(user_id, provider)
sync_connector(user_id, provider)
disconnect_connector(user_id, provider)
```

#### Calendar Tools

```ts
get_availability(user_id, date_range)
schedule_workout(user_id, workout_id, datetime)
reschedule_workout(user_id, scheduled_workout_id, datetime)
cancel_scheduled_workout(user_id, scheduled_workout_id)
```

## 11. REST / Internal API

The MCP server should call internal application APIs rather than directly querying databases.

Example endpoints:

```text
GET    /v1/users/:id
PATCH  /v1/users/:id
GET    /v1/users/:id/semantic-state?date=YYYY-MM-DD
POST   /v1/users/:id/semantic-state/recompute
GET    /v1/users/:id/recommendations/today
POST   /v1/users/:id/plans
GET    /v1/users/:id/plans/:planId
POST   /v1/users/:id/plans/:planId/adapt
GET    /v1/exercises
GET    /v1/exercises/:id
POST   /v1/workouts
GET    /v1/connectors
POST   /v1/connectors/:provider/sync
```

## 12. AI Orchestration

### Role of LLMs

LLMs should:

- Understand natural language requests.
- Call MCP tools.
- Explain recommendations.
- Ask follow-up questions when needed.
- Help users modify plans.
- Summarize progress.

LLMs should not:

- Directly compute recovery from raw HRV.
- Ignore injury constraints.
- Invent unavailable data.
- Mutate plans without previewing changes.
- Override deterministic safety rules.

### Agent Flow Example

User:

> 今天適合練什麼？

Flow:

```text
LLM
  -> get_semantic_fitness_state(user_id, today)
  -> recommend_today_workout(user_id)
  -> explain_today_recommendation(user_id)
  -> Return recommendation with reasoning and alternatives
```

### Plan Adaptation Example

User:

> 下週出差，只有每天 30 分鐘，幫我改課表。

Flow:

```text
LLM
  -> get_training_plan(user_id, active_plan)
  -> get_availability(user_id, next_week)
  -> preview_plan_change(user_id, plan_id, change_request)
  -> Ask user for confirmation
  -> commit_plan_change(user_id, plan_id, preview_id)
```

## 13. Security And Privacy

### Security Requirements

- Encrypt OAuth tokens at rest.
- Encrypt sensitive health data at rest.
- Use TLS everywhere.
- Use scoped access tokens.
- Use row-level access controls where appropriate.
- Maintain audit logs for data access and writes.
- Support user data export.
- Support user data deletion.
- Implement connector-level consent management.
- Avoid logging raw health payloads in application logs.
- Use least-privilege internal service access.

### MCP Safety Requirements

- Separate read and write tools.
- Require confirmation for scheduling, deleting, or committing plan changes.
- Return explanations for recommendations.
- Include confidence and missing data indicators.
- Never present generated plans as medical advice.
- Flag high-risk states such as unusual resting HR, severe fatigue, or pain reports.

### Compliance Considerations

Early version:

- Treat all health and fitness data as highly sensitive.
- Build HIPAA/GDPR-style controls even before formal compliance is required.

Future:

- GDPR export/delete workflows
- SOC 2 readiness
- HIPAA review if entering healthcare workflows

## 14. Testing Strategy

### Unit Tests

- Domain model validation
- Connector normalization
- Recovery scoring
- Training load calculation
- Muscle fatigue calculation
- Recommendation rules
- Injury contraindication rules
- MCP tool schema validation

### Integration Tests

- Connector sync to normalized events
- Normalized events to semantic state
- Semantic state to recommendation
- Plan generation to plan persistence
- MCP tool to service API
- OAuth token refresh

### Contract Tests

- MCP tool request/response schemas
- Connector provider payload contracts
- Internal REST API contracts
- Database migration compatibility

### Golden Dataset Tests

Maintain deterministic sample users:

- Beginner strength user
- Half marathon runner
- Overtrained endurance user
- Poor sleep recovery user
- Knee injury user
- Travel week user

Each dataset should produce expected semantic states and recommendations.

### Evaluation Tests

Evaluate AI responses against:

- Factual use of semantic state
- No invented health metrics
- Respect for constraints
- Clear explanation
- Safe plan adaptations
- Consistency across ChatGPT, Claude, and Gemini

## 15. Observability

Track:

- Connector sync success rate
- Last sync time by provider
- Semantic state recomputation time
- Recommendation latency
- MCP tool latency
- MCP tool error rate
- Missing data rates
- Plan adaptation acceptance rate
- User override rate
- Safety rule trigger count

## 16. Repository Layout

Recommended monorepo:

```text
fitness-mcp/
  README.md
  LICENSE
  .env.example
  docker-compose.yml
  package.json
  pnpm-workspace.yaml
  apps/
    mcp-server/
      src/
      tests/
    api/
      src/
      tests/
    web-dashboard/
      src/
      tests/
  packages/
    domain/
      src/
      tests/
    semantic-engine/
      src/
      tests/
    connectors/
      src/
      providers/
        apple-health/
        strava/
        garmin/
        oura/
        whoop/
      tests/
    graph/
      src/
      migrations/
    db/
      prisma/
      migrations/
      seeds/
    mcp-schemas/
      src/
      tests/
    recommendations/
      src/
      tests/
    planning/
      src/
      tests/
  docs/
    architecture.md
    domain-model.md
    mcp-tools.md
    connector-strategy.md
    security.md
    roadmap.md
  evals/
    golden-users/
    prompts/
    expected/
  infra/
    docker/
    terraform/
    fly/
    gcp/
  scripts/
    seed.ts
    recompute-semantic-state.ts
```

## 17. Suggested Tech Stack

### Backend

- TypeScript
- Node.js
- Fastify or Hono for API
- MCP TypeScript SDK
- Prisma or Drizzle for PostgreSQL
- Zod for schema validation
- BullMQ or Temporal for jobs

### Databases

- PostgreSQL
- TimescaleDB extension
- Neo4j or Memgraph
- Redis
- pgvector initially

### Frontend

- Next.js or Vite React
- Tailwind CSS or existing design system
- Recharts / ECharts for health charts

### Infrastructure

- Docker Compose for local development
- GCP Cloud Run or Fly.io for early deployment
- Cloud SQL / managed PostgreSQL
- Managed Redis
- Neo4j Aura or self-hosted Memgraph

## 18. Phased Roadmap

### Phase 0: Product And Technical Foundation

Duration: 1-2 weeks

Milestones:

- Finalize product vision.
- Define MVP user stories.
- Define domain model.
- Choose initial tech stack.
- Create repository.
- Create GitHub Project board.
- Create initial architecture docs.

Deliverables:

- `README.md`
- `docs/architecture.md`
- `docs/domain-model.md`
- `docs/mcp-tools.md`
- Initial issue backlog

### Phase 1: Core Domain And Local Data

Duration: 2-3 weeks

Milestones:

- Implement user, goal, preference, injury, equipment models.
- Implement exercise ontology seed data.
- Implement workout logging.
- Implement local seed connector.
- Implement semantic state object.

Deliverables:

- PostgreSQL schema
- Exercise graph seed
- Sample users
- Local semantic state generation

### Phase 2: Semantic Engine MVP

Duration: 3-4 weeks

Milestones:

- Compute sleep quality score.
- Compute recovery score.
- Compute readiness score.
- Compute acute and chronic training load.
- Compute muscle fatigue.
- Generate recommended focus.
- Generate explanation trace.

Deliverables:

- `semantic-engine` package
- Golden dataset tests
- Daily semantic state recomputation job

### Phase 3: MCP Server MVP

Duration: 2-3 weeks

Milestones:

- Implement MCP server.
- Add user profile tools.
- Add semantic state tools.
- Add workout recommendation tools.
- Add plan generation prototype.
- Test with at least one MCP client.

Deliverables:

- Working local MCP server
- Tool schemas
- Example client configuration
- Demo prompts

### Phase 4: First Real Connector

Duration: 2-4 weeks

Milestones:

- Implement Strava OAuth.
- Sync activities.
- Normalize run/ride/swim data.
- Map activity data to workouts and training load.
- Add connector status tools.

Deliverables:

- Strava connector
- Connector sync dashboard
- Connector integration tests

### Phase 5: Planning Engine MVP

Duration: 3-5 weeks

Milestones:

- Generate weekly training plan from goal.
- Support plan constraints.
- Support plan preview.
- Support plan commit.
- Support plan adaptation when user availability changes.

Deliverables:

- Planning package
- MCP planning tools
- Versioned plan history

### Phase 6: Dashboard And Observability

Duration: 3-4 weeks

Milestones:

- Create web dashboard.
- Show semantic state.
- Show training load.
- Show connector health.
- Show recommendation reasoning.
- Add admin/debug views.

Deliverables:

- Web dashboard
- Charts
- Observability events
- Basic admin tools

### Phase 7: Multi-Connector Expansion

Duration: 6-10 weeks

Milestones:

- Add Apple Health import path.
- Add Oura connector.
- Add WHOOP connector.
- Add Garmin strategy and initial integration path.
- Add source conflict resolution.
- Add metric confidence scoring.

Deliverables:

- Multiple connector support
- Unified metric resolution
- Provider-specific sync monitoring

### Phase 8: v1.0 Hardening

Duration: 4-6 weeks

Milestones:

- Security review.
- Token encryption.
- Audit logs.
- Data export/delete.
- Load testing.
- MCP contract tests.
- Cross-client validation.
- Production deployment.

Deliverables:

- v1.0 release
- Production docs
- Security docs
- Operational runbooks

## 19. MVP Scope

### Included

- User profile
- Goals
- Preferences
- Injuries
- Equipment
- Workout history
- Exercise ontology
- Manual import
- Daily semantic fitness state
- Rule-based recommendation
- MCP server
- Core MCP tools
- Local database
- Golden dataset tests

### Excluded

- Native mobile app
- Full Apple HealthKit sync
- Full Garmin partner integration
- Nutrition planning
- Payments
- Coach marketplace
- Advanced ML personalization

## 20. v1.0 Scope

### Included

- Multi-connector support
- Stable MCP interface
- Web dashboard
- Adaptive training plans
- Semantic state history
- Recommendation explanations
- Security controls
- Data export/delete
- Production deployment

### Excluded

- Medical diagnosis
- Clinical coaching
- Marketplace
- Social network features
- Fully autonomous plan changes without user confirmation

## 21. GitHub Project Structure

### Project Board Name

Fitness MCP

### Suggested Views

- Roadmap
- Current Sprint
- Backlog
- Epics
- Bugs
- Security
- Connectors
- MCP Tools
- v1.0 Release

### Fields

- Status: Backlog, Ready, In Progress, In Review, Done
- Phase: Phase 0 through Phase 8
- Type: Epic, Feature, Bug, Chore, Security, Docs, Test
- Priority: P0, P1, P2, P3
- Area: MCP, Semantic Engine, Connectors, Data, Graph, Planning, API, Dashboard, Infra, Security
- Milestone: MVP, Beta, v1.0

## 22. Epics And Issues

### Epic 1: Product Foundation

Issues:

- Define product vision and positioning
- Write architecture overview
- Write domain model document
- Define MVP acceptance criteria
- Create initial README
- Create local development setup

### Epic 2: Domain And Database

Issues:

- Design PostgreSQL schema
- Add user model
- Add goal model
- Add preference model
- Add injury model
- Add equipment model
- Add workout model
- Add semantic state model
- Add database migrations
- Add seed data

### Epic 3: Fitness Knowledge Graph

Issues:

- Define exercise ontology
- Add muscle model
- Add movement pattern model
- Add equipment relationships
- Add exercise variation relationships
- Add exercise substitution relationships
- Add injury contraindication relationships
- Seed initial exercise graph
- Add graph query service

### Epic 4: Semantic Engine

Issues:

- Implement daily metric aggregation
- Implement HRV baseline calculation
- Implement sleep score calculation
- Implement recovery score
- Implement readiness score
- Implement training load calculation
- Implement muscle fatigue calculation
- Implement goal alignment score
- Implement recommendation focus generator
- Implement explanation trace generator

### Epic 5: MCP Server

Issues:

- Scaffold MCP server
- Define MCP tool schemas
- Implement `get_user_profile`
- Implement `get_semantic_fitness_state`
- Implement `recommend_today_workout`
- Implement `explain_today_recommendation`
- Implement `search_exercises`
- Implement `generate_training_plan`
- Add MCP integration tests
- Add example MCP client config

### Epic 6: Connector Framework

Issues:

- Define connector interface
- Add connector account model
- Add raw event model
- Add normalized event model
- Add sync job framework
- Add connector status API
- Add connector error handling
- Add rate limit handling

### Epic 7: Strava Connector

Issues:

- Implement Strava OAuth
- Sync activities
- Normalize run activity
- Normalize ride activity
- Normalize swim activity
- Map Strava activities to workouts
- Add Strava sync tests
- Add Strava connector docs

### Epic 8: Apple Health Import

Issues:

- Define Apple Health import format
- Parse Apple Health export
- Normalize sleep data
- Normalize HRV data
- Normalize resting HR data
- Normalize steps data
- Normalize weight data
- Add Apple Health import tests

### Epic 9: Planning Engine

Issues:

- Define plan model
- Define planned workout model
- Generate weekly plan from goal
- Add availability constraints
- Add equipment constraints
- Add injury constraints
- Add plan preview
- Add plan commit
- Add plan version history

### Epic 10: Dashboard

Issues:

- Scaffold web dashboard
- Show semantic state
- Show recovery/readiness trends
- Show training load
- Show muscle fatigue
- Show connector status
- Show recommendation reasoning
- Show active plan

### Epic 11: Security And Privacy

Issues:

- Encrypt OAuth tokens
- Add audit logs
- Add consent records
- Add user data export
- Add user data deletion
- Add secrets management
- Add access control checks
- Add security test checklist

### Epic 12: Testing And Evaluation

Issues:

- Add unit test setup
- Add integration test setup
- Add MCP contract tests
- Add connector contract tests
- Add golden user datasets
- Add recommendation expected outputs
- Add AI response evaluation rubric
- Add CI workflow

### Epic 13: Infrastructure And Release

Issues:

- Add Docker Compose
- Add local development docs
- Add deployment config
- Add background worker
- Add monitoring
- Add logging
- Add v1.0 release checklist
- Add production runbook

## 23. MVP Milestones

### Milestone: MVP Alpha

Acceptance criteria:

- A local user can be seeded.
- A workout history can be imported.
- Semantic state can be generated.
- MCP client can ask for today's readiness.
- MCP client can receive a recommended workout focus.
- Recommendation includes explanation trace.

### Milestone: MVP Beta

Acceptance criteria:

- Strava connector works for one test account.
- Exercise graph supports substitutions.
- Daily semantic state updates after sync.
- MCP tools are covered by contract tests.
- Golden user tests are deterministic.

### Milestone: MVP Release

Acceptance criteria:

- README documents setup and usage.
- Local Docker Compose starts all services.
- MCP server can connect to at least one LLM client.
- Semantic engine has tests for all core scores.
- Security basics are implemented.

## 24. v1.0 Milestones

### Milestone: Multi-Connector Beta

Acceptance criteria:

- At least three providers are supported.
- Metric conflicts are resolved predictably.
- Connector health is visible.
- Sync failures are retryable and observable.

### Milestone: Planning Beta

Acceptance criteria:

- Users can generate a multi-week plan.
- Users can adapt a plan due to travel, fatigue, or missed workouts.
- Plan changes are previewed before commit.
- Plan version history is stored.

### Milestone: v1.0

Acceptance criteria:

- Production deployment is documented.
- Security checklist is complete.
- Data export and deletion work.
- MCP tools are stable.
- Cross-client behavior is validated.
- Dashboard provides clear semantic state observability.

## 25. Initial README Outline

```md
# Fitness MCP

Fitness MCP is a model-agnostic personal fitness intelligence layer exposed through MCP.

It normalizes data from Apple Health, Garmin, Strava, Oura, WHOOP, and other sources into a Semantic Fitness Layer that AI clients can query consistently.

## Core Features

- Semantic Fitness State
- Fitness Knowledge Graph
- MCP tools for LLM clients
- Workout recommendations
- Adaptive training plans
- Connector framework

## Local Development

Instructions coming soon.

## Roadmap

See docs/roadmap.md.
```

## 26. Key Technical Risks

### Provider Access Risk

Garmin and Apple Health may require special integration paths.

Mitigation:

- Start with Strava and manual Apple Health export.
- Build connector framework before relying on any single provider.

### Recommendation Safety Risk

Fitness advice can be unsafe if injury, fatigue, or recovery state is ignored.

Mitigation:

- Deterministic safety rules.
- Injury constraints.
- Conservative defaults.
- Clear disclaimers.
- Human confirmation for plan changes.

### Data Quality Risk

Different platforms may disagree.

Mitigation:

- Source confidence scoring.
- Metric priority rules.
- Data freshness indicators.
- Missing data explanations.

### LLM Consistency Risk

Different AI clients may respond differently.

Mitigation:

- Keep semantic state structured.
- Keep MCP tool outputs explicit.
- Provide reasoning traces.
- Add cross-client evaluation tests.

## 27. Recommended First Sprint

Sprint goal:

Create a local end-to-end prototype where an MCP client can ask "What should I do today?" and receive an answer based on generated semantic state.

Tasks:

1. Create repo skeleton.
2. Add PostgreSQL schema for user, goal, workout, health metric, semantic state.
3. Add seed user and seed workout history.
4. Implement semantic state generator.
5. Implement `get_semantic_fitness_state`.
6. Implement `recommend_today_workout`.
7. Add golden dataset test.
8. Write README setup instructions.

Definition of done:

- `docker compose up` starts local dependencies.
- Seed script creates a test user.
- Semantic state generation succeeds.
- MCP tool returns structured JSON.
- Recommendation includes reasoning.
- Tests pass locally.

## 28. Strategic Summary

Fitness MCP should be built as a fitness intelligence infrastructure layer, not merely a mobile app or workout chatbot.

The durable asset is the Semantic Fitness Layer:

- It understands the user.
- It normalizes fragmented health data.
- It computes stable fitness meaning.
- It exposes that meaning through MCP.
- It lets any AI client produce consistent, personalized coaching.

This is the foundation for a future cross-platform AI fitness operating system.
