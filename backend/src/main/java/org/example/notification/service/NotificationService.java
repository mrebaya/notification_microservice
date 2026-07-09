package org.example.notification.service;

import org.example.notification.entity.Notification;
import org.example.notification.entity.NotificationType;
import org.example.notification.repository.NotificationRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;

import java.util.List;

@Service
public class NotificationService {

    @Autowired
    private NotificationRepository repository;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;


    public Notification envoyerNotification(NotificationType type, String message, Long userId) {
        Notification notif = new Notification(type, message, userId);
        Notification saved = repository.save(notif);


        messagingTemplate.convertAndSend("/topic/notifications/" + userId, saved);

        return saved;
    }


    public List<Notification> getNotificationsNonLues(Long userId) {
        return repository.findByUserIdAndLuFalse(userId);
    }


    public void marquerCommeLue(Long id) {
        Notification notif = repository.findById(id)
                .orElseThrow(() -> new RuntimeException("Notification introuvable avec id: " + id));
        notif.setLu(true);
        repository.save(notif);
    }


    public void supprimerNotification(Long id) {
        Notification notif = repository.findById(id)
                .orElseThrow(() -> new RuntimeException("Notification introuvable avec id: " + id));
        repository.delete(notif);
    }

}
