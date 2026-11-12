export async function notifyUsers(
  db: any,
  recipientIds: string[],
  actorId: string,
  input: { type: string; title: string; message: string; groupId?: string; entityType?: string; entityId?: string },
) {
  const recipients = [...new Set(recipientIds)].filter(id => id && id !== actorId);
  if (!recipients.length) return;
  await db.notification.createMany({
    data: recipients.map(userId => ({ userId, actorId, ...input })),
  });
}
