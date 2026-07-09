export type NotificationType = "CONGE" | "TELETRAVAIL" | "MISSION" | "AUTRE" | "URGENT";

export interface NotificationItem {
  id: number;
  type: NotificationType;
  message: string;
  userId: number;
  lu: boolean;
  dateCreation: string;
}

export interface NotificationPayload {
  type: NotificationType;
  message: string;
  userId: number;
}

const API_BASE_URL = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "").replace(/\/$/, "");

export async function fetchUnreadNotifications(userId: number): Promise<NotificationItem[]> {
  const response = await fetch(`${API_BASE_URL}/api/notifications/${userId}`, {
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Impossible de charger les notifications.");
  }

  return response.json();
}

export async function createNotification(payload: NotificationPayload): Promise<NotificationItem> {
  const response = await fetch(`${API_BASE_URL}/api/notifications`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw new Error("Impossible de créer la notification.");
  }

  return response.json();
}

export async function markNotificationAsRead(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/notifications/${id}/lu`, {
    method: "PUT",
  });

  if (!response.ok) {
    throw new Error("Impossible de marquer la notification comme lue.");
  }
}

export async function deleteNotification(id: number): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/api/notifications/${id}`, {
    method: "DELETE",
  });

  if (!response.ok) {
    throw new Error("Impossible de supprimer la notification.");
  }
}

export const notificationTypes: NotificationType[] = ["CONGE", "TELETRAVAIL", "MISSION", "AUTRE", "URGENT"];

export const wsUrl = (process.env.NEXT_PUBLIC_WS_URL ?? "http://localhost:8080/ws").replace(/\/$/, "");