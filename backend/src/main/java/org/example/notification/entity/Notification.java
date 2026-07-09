package org.example.notification.entity;

import jakarta.persistence.*;
import java.time.LocalDateTime;

@Entity
@Table(name = "notifications")
public class Notification {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Enumerated(EnumType.STRING)
    private NotificationType type;

    private String message;

    @Column(name = "user_id")
    private Long userId;

    private boolean lu = false;

    @Column(name = "date_creation")
    private LocalDateTime dateCreation = LocalDateTime.now();


    public Notification() {}

    public Notification(NotificationType type, String message, Long userId) {
        this.type = type;
        this.message = message;
        this.userId = userId;
        this.dateCreation = LocalDateTime.now();
        this.lu = false;
    }


    public Long getId() { return id; }
    public NotificationType getType() { return type; }
    public void setType(NotificationType type) { this.type = type; }

    public String getMessage() { return message; }
    public void setMessage(String message) { this.message = message; }

    public Long getUserId() { return userId; }
    public void setUserId(Long userId) { this.userId = userId; }

    public boolean isLu() { return lu; }
    public void setLu(boolean lu) { this.lu = lu; }

    public LocalDateTime getDateCreation() { return dateCreation; }
    public void setDateCreation(LocalDateTime dateCreation) { this.dateCreation = dateCreation; }
}
