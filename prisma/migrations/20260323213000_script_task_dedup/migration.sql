CREATE UNIQUE INDEX uidx_generation_tasks_script_active
  ON generation_tasks(batch_id, task_type)
  WHERE task_type = 'script_generation'
    AND status IN ('draft', 'queued', 'running');
