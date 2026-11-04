import { randomBytes } from 'node:crypto';
import { hashPasswordSync, hashToken } from './auth.mjs';
import {
  audit,
  getPost,
  insertPost,
  insertResource,
  toUser,
  transaction,
  writePostRevision,
} from './database.mjs';
import { userCreateSchema } from './validation.mjs';
export const DEMO_MANAGER_ID = 'manager_demo';
export const DEMO_CONTRIBUTOR_ID = 'contributor_demo';
export async function initializeWorkspace(db, config, now) {
  return transaction(db, async () => {
    if (db.kind === 'postgres') {
      await db
        .prepare('SELECT pg_advisory_xact_lock(hashtext(?))')
        .get(`smis:${db.schema}:initialize`);
    }
    const existingMode = (
      await db.prepare("SELECT value FROM workspace_metadata WHERE key = 'mode'").get()
    )?.value;
    const requestedMode = config.demoMode ? 'demo' : 'production';
    if (existingMode && existingMode !== requestedMode) {
      throw new Error(
        `This database belongs to a ${existingMode} workspace. Use a separate DATABASE_PATH for ${requestedMode}; demo data must never be promoted to production.`,
      );
    }
    if (existingMode) {
      const manager = await db
        .prepare("SELECT id FROM users WHERE role = 'manager' AND active = 1 LIMIT 1")
        .get();
      if (!manager)
        throw new Error(
          'Workspace has no active manager. Restore a valid database backup instead of silently resetting credentials.',
        );
      return;
    }
    let count = 0;
    for (const table of [
      'users',
      'posts',
      'competitors',
      'sources',
      'tasks',
      'documents',
      'opportunities',
    ])
      count += Number((await db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()).count);
    if (count > 0)
      throw new Error(
        'Database contains data but has no workspace mode marker. Review the migration before starting.',
      );
    const timestamp = now.toISOString();
    if (config.demoMode) {
      await transaction(db, async () => {
        await db
          .prepare('INSERT INTO workspace_metadata(key, value) VALUES (?, ?)')
          .run('mode', 'demo');
        await seedDemo(db, now);
      });
      return;
    }
    // Bootstrap and normal account creation must use the same validation. A more
    // permissive bootstrap email check could create an account rejected at login.
    const account = userCreateSchema.safeParse({
      name:
        String(config.adminName || 'Workspace manager')
          .trim()
          .slice(0, 180) || 'Workspace manager',
      email: String(config.adminEmail ?? '').trim(),
      password: config.adminPassword || undefined,
      role: 'manager',
    });
    const setupToken = config.adminSetupToken;
    const validSetupToken =
      typeof setupToken === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(setupToken);
    if (!account.success || (!account.data.password && !validSetupToken)) {
      throw new Error(
        'A new production workspace requires BOOTSTRAP_ADMIN_EMAIL and either BOOTSTRAP_ADMIN_PASSWORD (12–256 characters) or a strong BOOTSTRAP_SETUP_TOKEN. There are no default production credentials.',
      );
    }
    const { name, email, password } = account.data;
    const passwordHash = hashPasswordSync(password ?? randomBytes(48).toString('base64url'));
    await transaction(db, async () => {
      await db
        .prepare('INSERT INTO workspace_metadata(key, value) VALUES (?, ?)')
        .run('mode', 'production');
      await db
        .prepare(
          `INSERT INTO users(id, name, email, role, password_hash, created_at, updated_at, setup_pending)
      VALUES (?, ?, ?, 'manager', ?, ?, ?, ?)`,
        )
        .run('manager_initial', name, email, passwordHash, timestamp, timestamp, Number(!password));
      if (validSetupToken) {
        await db
          .prepare(
            `INSERT INTO account_setup_tokens(token_hash, user_id, purpose, created_by, created_at, expires_at)
            VALUES (?, ?, 'setup', NULL, ?, ?)`,
          )
          .run(
            hashToken(setupToken),
            'manager_initial',
            timestamp,
            now.getTime() + 24 * 60 * 60 * 1000,
          );
      }
      await audit(
        db,
        null,
        'Workspace initialized',
        'workspace',
        'Production workspace created. No providers are connected; publishing is disabled.',
        timestamp,
      );
    });
  });
}
async function seedDemo(db, now) {
  const timestamp = now.toISOString();
  const shift = (hours) => new Date(now.getTime() + hours * 3600000).toISOString();
  const day = (offset) => new Date(now.getTime() + offset * 86400000).toISOString().slice(0, 10);
  // Demo authentication happens through a session-only role switch, never a
  // publicly documented password that might accidentally survive production.
  const passwordHash = hashPasswordSync(randomBytes(48).toString('base64url'));
  for (const person of [
    { id: DEMO_MANAGER_ID, name: 'School Manager', email: 'manager@example.test', role: 'manager' },
    {
      id: DEMO_CONTRIBUTOR_ID,
      name: 'Admissions Team',
      email: 'team@example.test',
      role: 'contributor',
    },
  ]) {
    await db
      .prepare(
        'INSERT INTO users(id, name, email, role, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(person.id, person.name, person.email, person.role, passwordHash, timestamp, timestamp);
  }
  const manager = toUser(await db.prepare('SELECT * FROM users WHERE id = ?').get(DEMO_MANAGER_ID));
  const posts = [
    {
      title: 'Your next attempt. A clearer plan.',
      caption:
        'Demo draft — a possible introduction to our NEET repeaters programme. Replace this sample with confirmed programme details before use.\n\nStart with a diagnosis. Build a practice routine. Review mistakes together.\n\nTalk to our admissions team about the current programme.',
      platforms: ['instagram', 'facebook'],
      format: 'Carousel',
      institution: 'St. Mary’s ISC',
      status: 'draft',
      palette: 'navy',
      ownerId: DEMO_CONTRIBUTOR_ID,
    },
    {
      title: 'Inside a day at St. Mary’s',
      caption:
        'Demo draft — classroom moments, student questions and the people who make learning possible.\n\nA short campus story for parents exploring their next step. Confirm footage permissions and every programme detail before publishing.',
      platforms: ['instagram', 'youtube'],
      format: 'Reel',
      institution: 'St. Mary’s ISC',
      status: 'in_review',
      palette: 'violet',
      ownerId: DEMO_CONTRIBUTOR_ID,
    },
    {
      title: 'Choosing your Grade 11 pathway',
      caption:
        'Demo draft — Science or Commerce? Start with your interests, subjects and the entrance examinations you may want to prepare for.\n\nSpeak with our team to understand the available pathways and current admission requirements.',
      platforms: ['instagram', 'facebook', 'linkedin'],
      format: 'Carousel',
      institution: 'St. Mary’s ISC',
      status: 'in_review',
      palette: 'sage',
      ownerId: DEMO_CONTRIBUTOR_ID,
    },
    {
      title: 'Meet the people behind the learning',
      caption:
        'Demo draft — introduce a teacher through one question they love hearing from students. Add a verified biography and an approved portrait before publication.',
      platforms: ['instagram', 'linkedin'],
      format: 'Post',
      institution: 'St. Mary’s ICSE',
      status: 'approved',
      palette: 'peach',
      ownerId: DEMO_MANAGER_ID,
    },
    {
      title: 'Your campus visit starts here',
      caption:
        'Demo draft — a visit can help you picture the next chapter. Explore the campus, ask your questions and discuss the right learning pathway with our team.\n\nConfirm visit availability with admissions.',
      platforms: ['instagram', 'facebook'],
      format: 'Post',
      institution: 'St. Mary’s ISC',
      status: 'scheduled',
      scheduledAt: shift(48),
      palette: 'navy',
      ownerId: DEMO_MANAGER_ID,
    },
    {
      title: 'Small questions. Big discoveries.',
      caption:
        'Demo draft — a glimpse of playful learning at St. Mary’s Kids. Replace with approved classroom photographs and verified information about the location and age group.',
      platforms: ['instagram', 'facebook'],
      format: 'Carousel',
      institution: 'St. Mary’s Kids',
      status: 'draft',
      palette: 'peach',
      ownerId: DEMO_MANAGER_ID,
    },
    {
      title: 'A guide to our learning pathways',
      caption:
        'Demo draft — help parents compare the learning pathways available across St. Mary’s. Verify board, grade and subject availability before using this guide.',
      platforms: ['facebook', 'linkedin'],
      format: 'Article',
      institution: 'Cambridge MGS',
      status: 'changes_requested',
      palette: 'sage',
      ownerId: DEMO_CONTRIBUTOR_ID,
      feedback:
        'Confirm current subject combinations and add the source for each programme detail.',
    },
    {
      title: 'Questions to bring on a school visit',
      caption:
        'Demo draft — ask about classroom routines, student support, subject choices and how progress is shared with parents. Bring your questions to a campus visit.',
      platforms: ['instagram', 'facebook'],
      format: 'Carousel',
      institution: 'St. Mary’s ICSE',
      status: 'scheduled',
      scheduledAt: shift(72),
      palette: 'violet',
      ownerId: DEMO_CONTRIBUTOR_ID,
    },
  ];
  for (const [index, item] of posts.entries()) {
    const approved = ['approved', 'scheduled'].includes(item.status);
    const post = {
      ...item,
      id: `demo_post_${index + 1}`,
      language: 'English',
      revision: 1,
      scheduledAt: item.scheduledAt ?? null,
      createdAt: shift(-96 - index * 2),
      updatedAt: shift(-index * 2),
      sample: true,
      approvedRevision: approved ? 1 : null,
      approvedBy: approved ? DEMO_MANAGER_ID : null,
      approvedAt: approved ? shift(-1 - index) : null,
    };
    await insertPost(db, post);
    await writePostRevision(db, await getPost(db, post.id), post.ownerId, post.createdAt);
  }
  const opportunities = [
    {
      title: 'Turn an exam notice into a parent checklist',
      category: 'Exam update',
      source: 'NTA · sample briefing',
      sourceUrl: 'https://www.nta.ac.in/',
      summary:
        'Illustrative opportunity, not a current exam announcement. Review a real notice from the official examination authority, then explain the action a parent or student needs to take.',
      audience: 'Grade 11–12 students and parents',
      contentAngle:
        'A short Kannada + English checklist: what changed, who it affects and which official page to open.',
      priority: 'high',
    },
    {
      title: 'Explain a medical seat update without overpromising',
      category: 'Medical seats',
      source: 'NMC · sample briefing',
      sourceUrl: 'https://www.nmc.org.in/',
      summary:
        'Illustrative opportunity. No new college approval or seat count has been verified here. Compare an official permission notice with the appropriate counselling seat matrix before drafting a numerical claim.',
      audience: 'NEET aspirants and parents',
      contentAngle:
        'Explain the difference between a college announcement, approved intake and seats available in counselling.',
      priority: 'high',
    },
    {
      title: 'Make a board circular easier to understand',
      category: 'Board update',
      source: 'CISCE · sample briefing',
      sourceUrl: 'https://cisce.org/',
      summary:
        'Illustrative opportunity, not a current board update. Save an official circular and turn its relevant instructions into a simple student checklist.',
      audience: 'ICSE and ISC families',
      contentAngle: 'One verified change, its effective year and the next practical step.',
      priority: 'medium',
    },
    {
      title: 'A content pattern worth discussing',
      category: 'Competitor',
      source: 'Example Academy · sample observation',
      sourceUrl: 'https://example.com/sample-competitor',
      summary:
        'Illustrative competitor observation. No live competitor profile has been checked. This card demonstrates how a public post could become a discussion brief for your team.',
      audience: 'Marketing team',
      contentAngle:
        'Study the question and format, then create an original answer using verified St. Mary’s information.',
      priority: 'medium',
    },
    {
      title: 'Five questions parents ask before Grade 11',
      category: 'Content idea',
      source: 'Team brainstorming · sample',
      sourceUrl: 'https://example.com/sample-content-brief',
      summary:
        'Illustrative content idea: collect recurring questions from admissions conversations, remove personal details and build a clear guide for parents.',
      audience: 'Grade 10 parents',
      contentAngle: 'A question-led carousel with a simple campus-visit invitation.',
      priority: 'low',
    },
  ];
  for (const [index, item] of opportunities.entries()) {
    await db
      .prepare(
        `INSERT INTO opportunities(id, title, summary, source, source_url, category, published_at,
      verified, status, priority, audience, content_angle, source_kind, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, 'sample', ?, ?)`,
      )
      .run(
        `demo_opportunity_${index + 1}`,
        item.title,
        item.summary,
        item.source,
        item.sourceUrl,
        item.category,
        shift(-4 - index * 3),
        index === 4 ? 'saved' : 'new',
        item.priority,
        item.audience,
        item.contentAngle,
        timestamp,
        timestamp,
      );
  }
  for (const [index, values] of [
    {
      name: 'Example Academy',
      platform: 'youtube',
      url: 'https://example.com/sample-youtube',
      category: 'Sample competitor',
      notes:
        'Illustrative profile. Replace with a real public URL; this release does not fetch social media.',
      monitoringStatus: 'manual',
    },
    {
      name: 'Example Learning Group',
      platform: 'instagram',
      url: 'https://example.com/sample-instagram',
      category: 'Sample competitor',
      notes: 'Illustrative profile. No live monitoring or imported metrics.',
      monitoringStatus: 'manual',
    },
    {
      name: 'Example School',
      platform: 'website',
      url: 'https://example.com/sample-school',
      category: 'Sample competitor',
      notes: 'Illustrative profile for testing your watchlist.',
      monitoringStatus: 'paused',
    },
  ].entries()) {
    const item = await insertResource(
      db,
      'competitors',
      values,
      timestamp,
      `demo_competitor_${index + 1}`,
    );
    await db.prepare('UPDATE competitors SET sample = 1 WHERE id = ?').run(item.id);
  }
  for (const [index, values] of [
    {
      name: 'National Testing Agency',
      url: 'https://www.nta.ac.in/',
      category: 'Competitive exams',
    },
    {
      name: 'National Medical Commission',
      url: 'https://www.nmc.org.in/',
      category: 'Medical education',
    },
    { name: 'Medical Counselling Committee', url: 'https://mcc.nic.in/', category: 'Counselling' },
    {
      name: 'Karnataka Examinations Authority',
      url: 'https://cetonline.karnataka.gov.in/kea/',
      category: 'Karnataka admissions',
    },
    { name: 'CISCE', url: 'https://cisce.org/', category: 'Board updates' },
    { name: 'CBSE', url: 'https://www.cbse.gov.in/', category: 'Board updates' },
  ].entries())
    await insertResource(
      db,
      'sources',
      { ...values, status: 'manual' },
      timestamp,
      `demo_source_${index + 1}`,
    );
  for (const [index, values] of [
    {
      title: 'Demo · Review the Grade 11 carousel',
      owner: 'School Manager',
      dueDate: day(0),
      status: 'todo',
      priority: 'high',
    },
    {
      title: 'Demo · Collect approved campus photographs',
      owner: 'Admissions Team',
      dueDate: day(1),
      status: 'in_progress',
      priority: 'medium',
    },
    {
      title: 'Demo · Check the original examination notice',
      owner: 'Admissions Team',
      dueDate: day(2),
      status: 'todo',
      priority: 'high',
    },
    {
      title: 'Demo · Draft the weekly content brief',
      owner: 'School Manager',
      dueDate: day(3),
      status: 'done',
      priority: 'low',
    },
  ].entries())
    await insertResource(db, 'tasks', values, timestamp, `demo_task_${index + 1}`);
  for (const [index, values] of [
    {
      title: 'Brand voice & content principles',
      category: 'Demo guide',
      content:
        '# A useful starting point\n\nThis is illustrative workspace content. Confirm your final guidelines with the team.\n\nWrite clearly and warmly. Explain what students and parents can do next. Use only verified programme details, dates and results.\n\n## Before submitting\n\n- Add the original source for factual updates.\n- Check Kannada phrasing with a fluent reviewer.\n- Confirm permission to use photographs.\n- Include the institution and academic year.\n\nEvery edited approved draft needs approval again.',
    },
    {
      title: 'Exam update briefing template',
      category: 'Demo template',
      content:
        '# Source first\n\nThis is a sample template, not an exam announcement.\n\nOfficial source URL:\nPublication date:\nEffective academic year:\nWho is affected:\nWhat changed:\nWhat students should do next:\nVerification notes:\n\n## Proposed content\n\nAudience:\nEnglish explanation:\nKannada explanation:\nCall to action:\n\nManager approval applies to a specific revision.',
    },
    {
      title: 'Weekly marketing review',
      category: 'Demo planning',
      content:
        '# Weekly review\n\nIllustrative agenda. Analytics in this demo are sample values. No accounts are connected.\n\n1. Review parent enquiries and visit outcomes.\n2. Review submitted drafts and feedback.\n3. Check primary sources for useful exam updates.\n4. Choose the coming week’s priorities.\n5. Confirm owners and deadlines.\n\nLocal scheduling in this release does not publish to any platform.',
    },
  ].entries())
    await insertResource(db, 'documents', values, shift(-index), `demo_document_${index + 1}`);
  const reach = [
    2180, 2640, 2330, 3190, 2940, 3650, 3280, 4110, 3820, 4380, 4050, 5120, 4740, 5480,
  ];
  const analytics = {
    sample: true,
    points: reach.map((value, index) => ({
      date: day(index - 13),
      reach: value,
      engagement: Math.round(value * (0.037 + (index % 3) * 0.006)),
      enquiries: [7, 9, 6, 12, 10, 14, 11, 16, 13, 18, 15, 21, 19, 23][index],
    })),
    campaigns: [
      {
        id: 'demo_campaign_1',
        name: 'Demo · ISC admissions awareness',
        platform: 'Meta Ads',
        status: 'active',
        spend: 8400,
        impressions: 62100,
        clicks: 972,
        enquiries: 42,
        sample: true,
      },
      {
        id: 'demo_campaign_2',
        name: 'Demo · Campus visit enquiries',
        platform: 'Google Ads',
        status: 'active',
        spend: 6200,
        impressions: 18400,
        clicks: 683,
        enquiries: 31,
        sample: true,
      },
      {
        id: 'demo_campaign_3',
        name: 'Demo · Early years introduction',
        platform: 'Meta Ads',
        status: 'paused',
        spend: 3200,
        impressions: 27800,
        clicks: 406,
        enquiries: 17,
        sample: true,
      },
    ],
    channels: [
      { platform: 'instagram', followers: 4280, reach: 28640, engagement: 1375 },
      { platform: 'facebook', followers: 6120, reach: 19320, engagement: 696 },
      { platform: 'youtube', followers: 1840, reach: 8120, engagement: 422 },
      { platform: 'linkedin', followers: 720, reach: 3240, engagement: 133 },
    ],
  };
  await db
    .prepare('INSERT INTO analytics_samples(id, data) VALUES (1, ?)')
    .run(JSON.stringify(analytics));
  await audit(
    db,
    manager,
    'Demo workspace initialized',
    'workspace',
    'Illustrative drafts and analytics loaded. No sources have been fetched, no accounts are connected, and no publishing is enabled.',
    timestamp,
  );
}
