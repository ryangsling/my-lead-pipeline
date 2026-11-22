-- Run as the migration role before applying 0015. Only identifiers are reported.
WITH links (child_table, child_id, child_workspace_id, parent_column, parent_id, parent_workspace_id) AS (
  SELECT 'appointments', a.id, a.workspace_id, link.*
  FROM public.appointments a
  LEFT JOIN public.contacts c ON c.id = a.contact_id
  LEFT JOIN public.services s ON s.id = a.service_id
  LEFT JOIN public.conversations v ON v.id = a.conversation_id
  CROSS JOIN LATERAL (VALUES ('contact_id', a.contact_id, c.workspace_id),
    ('service_id', a.service_id, s.workspace_id), ('conversation_id', a.conversation_id, v.workspace_id)) link
  UNION ALL
  SELECT 'conversations', v.id, v.workspace_id, 'contact_id', v.contact_id, c.workspace_id
  FROM public.conversations v LEFT JOIN public.contacts c ON c.id = v.contact_id
  UNION ALL
  SELECT 'jobs', j.id, j.workspace_id, link.*
  FROM public.jobs j
  LEFT JOIN public.contacts c ON c.id = j.contact_id
  LEFT JOIN public.conversations v ON v.id = j.conversation_id
  LEFT JOIN public.appointments a ON a.id = j.appointment_id
  CROSS JOIN LATERAL (VALUES ('contact_id', j.contact_id, c.workspace_id),
    ('conversation_id', j.conversation_id, v.workspace_id), ('appointment_id', j.appointment_id, a.workspace_id)) link
  UNION ALL
  SELECT 'notification_log', n.id, n.workspace_id, link.*
  FROM public.notification_log n
  LEFT JOIN public.notification_channels c ON c.id = n.channel_id
  LEFT JOIN public.conversations v ON v.id = n.urgent_conversation_id
  CROSS JOIN LATERAL (VALUES ('channel_id', n.channel_id, c.workspace_id),
    ('urgent_conversation_id', n.urgent_conversation_id, v.workspace_id)) link
  UNION ALL
  SELECT 'offered_slots', o.id, o.workspace_id, link.*
  FROM public.offered_slots o
  LEFT JOIN public.services s ON s.id = o.service_id
  LEFT JOIN public.conversations v ON v.id = o.conversation_id
  CROSS JOIN LATERAL (VALUES ('service_id', o.service_id, s.workspace_id),
    ('conversation_id', o.conversation_id, v.workspace_id)) link
  UNION ALL
  SELECT 'phone_number_changes', n.id, n.workspace_id, 'assistant_id', n.assistant_id, a.workspace_id
  FROM public.phone_number_changes n LEFT JOIN public.assistants a ON a.id = n.assistant_id
  UNION ALL
  SELECT 'phone_numbers', n.id, n.workspace_id, 'assistant_id', n.assistant_id, a.workspace_id
  FROM public.phone_numbers n LEFT JOIN public.assistants a ON a.id = n.assistant_id
  UNION ALL
  SELECT 'urgent_events', u.conversation_id, u.workspace_id, 'conversation_id', u.conversation_id, v.workspace_id
  FROM public.urgent_events u LEFT JOIN public.conversations v ON v.id = u.conversation_id
)
SELECT * FROM links WHERE parent_id IS NOT NULL AND parent_workspace_id IS DISTINCT FROM child_workspace_id
UNION ALL
SELECT 'assistant_syncs', s.id, NULL, 'missing assistant_id', s.assistant_id, NULL
FROM public.assistant_syncs s LEFT JOIN public.assistants a ON a.id = s.assistant_id WHERE a.id IS NULL
UNION ALL
SELECT 'messages', m.id, NULL, 'missing conversation_id', m.conversation_id, NULL
FROM public.messages m LEFT JOIN public.conversations v ON v.id = m.conversation_id WHERE v.id IS NULL
UNION ALL
SELECT 'webhook_events', id, workspace_id, 'scope conflicts with status', NULL, NULL
FROM public.webhook_events WHERE (workspace_id IS NULL) <> (status = 'unscoped')
ORDER BY child_table, child_id, parent_column;
