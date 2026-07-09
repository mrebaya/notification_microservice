package org.example.notification.controller;

import org.example.notification.entity.Notification;
import org.example.notification.service.NotificationService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping("/api/notifications")
public class NotificationController {

    @Autowired
    private NotificationService service;


    @PostMapping
    public Notification create(@RequestBody Notification notif) {
        return service.envoyerNotification(
                notif.getType(),
                notif.getMessage(),
                notif.getUserId()
        );
    }


    @GetMapping("/{userId}")
    public List<Notification> getNonLues(@PathVariable Long userId) {
        return service.getNotificationsNonLues(userId);
    }


    @PutMapping("/{id}/lu")
    public void markAsRead(@PathVariable Long id) {
        service.marquerCommeLue(id);
    }


    @DeleteMapping("/{id}")
    public void delete(@PathVariable Long id) {
        service.supprimerNotification(id);
    }

}
