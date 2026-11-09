import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import {
  CrmConversation,
  CrmConversationDocument,
  ConversationStatus,
  ConversationChannel,
} from './crm-conversation.schema';
import {
  CrmConversationMessage,
  CrmConversationMessageDocument,
  MessageSenderRole,
} from './crm-conversation-message.schema';

interface ClientConnection {
  ws: WebSocket;
  userId?: string;
  userEmail?: string;
  userName?: string;
  role: 'CUSTOMER' | 'SALES_REP' | 'STAFF';
  conversationId?: string;
  isAlive: boolean;
}

@Injectable()
export class CrmChatWebSocketService implements OnApplicationShutdown {
  private readonly logger = new Logger(CrmChatWebSocketService.name);
  private wss: WebSocketServer | null = null;
  private clients = new Set<ClientConnection>();
  private heartbeatInterval: NodeJS.Timeout | null = null;

  constructor(
    @InjectModel(CrmConversation.name)
    private readonly conversationModel: Model<CrmConversationDocument>,
    @InjectModel(CrmConversationMessage.name)
    private readonly messageModel: Model<CrmConversationMessageDocument>,
  ) {}

  initialize(httpServer: HttpServer): void {
    if (this.wss) return;

    this.wss = new WebSocketServer({
      server: httpServer,
      path: '/ws/crm-chat',
    });

    this.logger.log('CrmChatWebSocketService initialized on path /ws/crm-chat');

    this.wss.on('connection', (ws: WebSocket) => {
      const client: ClientConnection = {
        ws,
        role: 'CUSTOMER',
        isAlive: true,
      };
      this.clients.add(client);

      ws.on('pong', () => {
        client.isAlive = true;
      });

      ws.on('message', async (data: Buffer | string) => {
        try {
          const raw = typeof data === 'string' ? data : data.toString('utf8');
          const payload = JSON.parse(raw);
          await this.handleClientMessage(client, payload);
        } catch (err: any) {
          this.logger.error(`Failed to handle WS message: ${err.message}`);
          ws.send(JSON.stringify({ type: 'ERROR', message: err.message }));
        }
      });

      ws.on('close', () => {
        this.clients.delete(client);
      });

      ws.on('error', (err) => {
        this.logger.warn(`WS client error: ${err.message}`);
        this.clients.delete(client);
      });

      // Send initial connection acknowledgement
      ws.send(JSON.stringify({ type: 'CONNECTED', timestamp: new Date().toISOString() }));
    });

    // Ping clients every 30 seconds to keep connection alive
    this.heartbeatInterval = setInterval(() => {
      for (const client of this.clients) {
        if (!client.isAlive) {
          client.ws.terminate();
          this.clients.delete(client);
          continue;
        }
        client.isAlive = false;
        client.ws.ping();
      }
    }, 30000);
  }

  private async handleClientMessage(client: ClientConnection, payload: any): Promise<void> {
    switch (payload.type) {
      case 'AUTH':
      case 'JOIN': {
        client.userId = payload.userId;
        client.userEmail = payload.userEmail?.toLowerCase();
        client.userName = payload.userName;
        client.role = payload.role === 'SALES_REP' || payload.role === 'STAFF' ? 'SALES_REP' : 'CUSTOMER';
        client.conversationId = payload.conversationId;

        client.ws.send(
          JSON.stringify({
            type: 'JOINED',
            conversationId: client.conversationId,
            role: client.role,
          }),
        );
        break;
      }

      case 'SEND_MESSAGE': {
        const { conversationId, content, isInternal, senderName, senderEmail, senderRole } = payload;
        if (!conversationId || !content || !content.trim()) return;

        // Persist message in MongoDB
        const messageDoc = await this.messageModel.create({
          conversationId: new Types.ObjectId(conversationId),
          senderUserId: client.userId && Types.ObjectId.isValid(client.userId) ? new Types.ObjectId(client.userId) : undefined,
          senderName: senderName || client.userName || client.userEmail || 'User',
          senderEmail: (senderEmail || client.userEmail || 'user@alsm.dev').toLowerCase(),
          senderRole: (senderRole || client.role === 'SALES_REP' ? MessageSenderRole.SALES_REP : MessageSenderRole.CUSTOMER),
          content: content.trim(),
          isInternal: Boolean(isInternal),
          createdAt: new Date(),
        });

        // Update conversation summary
        const conv = await this.conversationModel.findById(conversationId);
        if (conv) {
          conv.lastMessage = isInternal ? `[Internal Note] ${content.substring(0, 60)}` : content.substring(0, 80);
          conv.lastMessageAt = new Date();
          if (client.role === 'CUSTOMER') {
            conv.status = ConversationStatus.OPEN;
            conv.unreadCount = (conv.unreadCount || 0) + 1;
          }
          await conv.save();

          this.broadcastConversationUpdated({
            id: conv._id.toString(),
            title: conv.title,
            status: conv.status,
            customerName: conv.customerName,
            customerEmail: conv.customerEmail,
            companyName: conv.companyName,
            lastMessage: conv.lastMessage,
            lastMessageAt: conv.lastMessageAt,
            unreadCount: conv.unreadCount,
          });
        }

        const formattedMsg = {
          id: messageDoc._id.toString(),
          conversationId,
          senderUserId: messageDoc.senderUserId?.toString(),
          senderName: messageDoc.senderName,
          senderEmail: messageDoc.senderEmail,
          senderRole: messageDoc.senderRole,
          content: messageDoc.content,
          isInternal: messageDoc.isInternal,
          createdAt: (messageDoc as any).createdAt ? (messageDoc as any).createdAt.toISOString() : new Date().toISOString(),
        };

        this.broadcastMessageToRoom(conversationId, formattedMsg);
        break;
      }

      case 'TYPING': {
        const { conversationId, isTyping } = payload;
        if (!conversationId) return;

        const event = JSON.stringify({
          type: 'TYPING',
          conversationId,
          userName: client.userName || client.userEmail,
          role: client.role,
          isTyping: Boolean(isTyping),
        });

        for (const c of this.clients) {
          if (c !== client && c.conversationId === conversationId && c.ws.readyState === WebSocket.OPEN) {
            c.ws.send(event);
          }
        }
        break;
      }
    }
  }

  broadcastMessageToRoom(conversationId: string, message: any): void {
    const payload = JSON.stringify({
      type: 'NEW_MESSAGE',
      conversationId,
      message,
    });

    for (const client of this.clients) {
      // Internal notes are only sent to sales reps/staff
      if (message.isInternal && client.role === 'CUSTOMER') {
        continue;
      }

      // Send to anyone currently viewing this conversation, or sales reps in FE2
      if (
        (client.conversationId === conversationId || client.role === 'SALES_REP') &&
        client.ws.readyState === WebSocket.OPEN
      ) {
        client.ws.send(payload);
      }
    }
  }

  broadcastConversationUpdated(conversation: any): void {
    const payload = JSON.stringify({
      type: 'CONVERSATION_UPDATED',
      conversation,
    });

    for (const client of this.clients) {
      if (client.role === 'SALES_REP' && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(payload);
      }
    }
  }

  onApplicationShutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }
    if (this.wss) {
      this.wss.close();
      this.wss = null;
    }
  }
}
