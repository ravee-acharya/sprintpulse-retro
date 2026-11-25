import Resolver from '@forge/resolver';
import { registerCardResolvers } from './cards';
import { registerJiraResolvers } from './jira';
import { registerRetroResolvers } from './retros';
import { rpc } from './rpc';

/**
 * RPC surface (all return RpcResult<T>; project + user always come from Forge context):
 *
 *  templates.list | templates.save | templates.delete
 *  retros.create | retros.list | retros.get | retros.update | retros.updateColumns
 *  retros.close | retros.reopen | retros.archive | retros.delete
 *  facilitator.setPhase | facilitator.reveal | facilitator.closeVoting | facilitator.timer
 *  facilitator.spotlight | facilitator.music | facilitator.icebreaker
 *  cards.add | cards.edit | cards.delete | cards.move | cards.group | cards.ungroup
 *  groups.update | cards.react | cards.comment | cards.deleteComment
 *  votes.cast | votes.summary | votes.reset | mood.set
 *  jira.sprints | jira.searchUsers | jira.users | jira.issueTypes
 *  actions.create | actions.update | actions.delete | actions.list | actions.createIssue | actions.sync
 *  analytics.team | confluence.spaces | confluence.publish | ping
 */
export const resolver = new Resolver();

rpc(resolver, 'ping', (_p, ctx) =>
  Promise.resolve({
    app: 'sprintpulse-retro',
    projectKey: ctx.projectKey,
    accountId: ctx.accountId,
    serverTime: Date.now(),
  }),
);

registerRetroResolvers(resolver);
registerCardResolvers(resolver);
registerJiraResolvers(resolver);
