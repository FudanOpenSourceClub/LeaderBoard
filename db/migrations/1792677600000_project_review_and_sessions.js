export const up = (pgm) => {
  pgm.sql(`
    CREATE TABLE website_sessions (
      token_hash TEXT PRIMARY KEY, github_id BIGINT NOT NULL, login TEXT NOT NULL,
      csrf_token TEXT NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE website_login_states (
      state_hash TEXT PRIMARY KEY, browser_hash TEXT NOT NULL, return_path TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL, used_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    ALTER TABLE project_proposals
      ADD COLUMN member_id BIGINT REFERENCES members(id),
      ADD COLUMN repository_github_id BIGINT,
      ADD COLUMN reviewed_by BIGINT,
      ADD COLUMN reviewed_at TIMESTAMPTZ,
      ADD COLUMN review_notes TEXT NOT NULL DEFAULT '';
    CREATE UNIQUE INDEX project_proposals_pending_repository_idx ON project_proposals(repository_github_id)
      WHERE status='pending' AND repository_github_id IS NOT NULL;
    CREATE TABLE campus_projects (
      id BIGSERIAL PRIMARY KEY, repository_github_id BIGINT NOT NULL UNIQUE,
      full_name TEXT NOT NULL, name TEXT NOT NULL, html_url TEXT NOT NULL UNIQUE,
      lab_name TEXT NOT NULL, lab_url TEXT, description TEXT NOT NULL,
      tags TEXT[] NOT NULL DEFAULT '{}', proposal_id BIGINT UNIQUE REFERENCES project_proposals(id),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO campus_projects(repository_github_id,full_name,name,html_url,lab_name,lab_url,description,tags) VALUES
      (124240220,'FudanNLP/fastNLP','fastNLP','https://github.com/FudanNLP/fastNLP','复旦大学自然语言处理实验室','https://nlp.fudan.edu.cn/28699/list.htm','面向自然语言处理任务的模块化、可扩展框架，复旦 NLP 实验室官网将其列为开源项目。',ARRAY['NLP','Python','开源框架']),
      (217049502,'FudanNLP/fastHan','fastHan','https://github.com/FudanNLP/fastHan','复旦大学自然语言处理实验室','https://nlp.fudan.edu.cn/28699/list.htm','中文分词、词性标注、依存分析和命名实体识别工具，同样收录在实验室官方开源项目页面。',ARRAY['中文 NLP','Python','工具']),
      (673859896,'FudanSELab/ClassEval','ClassEval','https://github.com/FudanSELab/ClassEval','复旦大学软件工程实验室','https://datascience.fudan.edu.cn/80/db/c13525a688347/page.htm','面向类级代码生成的 benchmark。项目位于 FudanSELab 组织，复旦校方页面可核验软件工程实验室信息。',ARRAY['Software Engineering','Benchmark','Python']);
    CREATE TABLE project_notification_outbox (
      id BIGSERIAL PRIMARY KEY, proposal_id BIGINT NOT NULL UNIQUE REFERENCES project_proposals(id),
      attempt_count INTEGER NOT NULL DEFAULT 0, sent_at TIMESTAMPTZ,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT now(), lease_until TIMESTAMPTZ,
      last_error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};
