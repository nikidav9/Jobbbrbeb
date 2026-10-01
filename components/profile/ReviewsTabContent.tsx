import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { EmptyState } from './EmptyState';
import { ReviewsEmptyIllustration } from './illustrations';
import { StarIcon } from './icons';
import { ProfileColors, ProfileFonts, ProfileRadius } from '@/constants/profileTheme';
import { dbGetRatingsForUser, UserRating } from '@/services/db';
import { getInitials } from '@/services/storage';

function ReviewCard({ rating, reviewerName }: { rating: UserRating; reviewerName: string }) {
  const date = new Date(rating.createdAt);
  const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}.${date.getFullYear()}`;
  return (
    <View style={s.card}>
      <View style={s.cardTop}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={s.name} numberOfLines={1}>{reviewerName}</Text>
          <Text style={s.date}>{dateStr}</Text>
        </View>
        <View style={s.stars}>
          {[1, 2, 3, 4, 5].map(n => (
            <StarIcon key={n} size={14} color={rating.rating >= n ? ProfileColors.accent : '#CFC5B7'} />
          ))}
        </View>
      </View>
      {rating.reviewText ? (
        <Text style={s.text}>«{rating.reviewText}»</Text>
      ) : (
        <Text style={s.noText}>Комментарий не оставлен</Text>
      )}
    </View>
  );
}

export function ReviewsTabContent({
  userId, users, scoreShifts,
}: {
  userId: string;
  users: { id: string; firstName: string; lastName: string; role: 'worker' | 'employer' }[];
  scoreShifts: number;
}) {
  const [ratings, setRatings] = useState<UserRating[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    dbGetRatingsForUser(userId)
      .then(list => { if (alive) setRatings(list); })
      .catch(() => {})
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [userId]);

  if (loading) {
    return (
      <View style={s.loading}>
        <ActivityIndicator size="small" color={ProfileColors.ink} />
      </View>
    );
  }

  if (ratings.length === 0) {
    const filled = Math.min(3, scoreShifts);
    return (
      <EmptyState
        illustration={<ReviewsEmptyIllustration />}
        title={'Отзывов\nпока нет'}
        subtitle="Здесь появятся отзывы работодателей"
      />
    );
  }

  const avg = ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length;

  return (
    <View style={s.content}>
      <View style={s.summary}>
        <Text style={s.summaryAvg}>{avg.toFixed(1)}</Text>
        <View>
          <View style={s.stars}>
            {[1, 2, 3, 4, 5].map(n => (
              <StarIcon key={n} size={16} color={avg >= n - 0.5 ? ProfileColors.accent : '#CFC5B7'} />
            ))}
          </View>
          <Text style={s.summaryCount}>
            {ratings.length} {ratings.length === 1 ? 'отзыв' : ratings.length < 5 ? 'отзыва' : 'отзывов'}
          </Text>
        </View>
      </View>
      {ratings.map(rating => {
        const reviewer = users.find(u => u.id === rating.fromUserId);
        const name = reviewer
          ? `${reviewer.firstName} ${reviewer.lastName}`.trim()
          : (rating.role === 'worker' ? 'Работник' : 'Работодатель');
        return <ReviewCard key={rating.id} rating={rating} reviewerName={name || getInitials(name)} />;
      })}
    </View>
  );
}

const s = StyleSheet.create({
  loading: { paddingVertical: 40, alignItems: 'center' },
  content: { gap: 10 },
  summary: {
    flexDirection: 'row', alignItems: 'center', gap: 14,
    backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, padding: 16,
  },
  summaryAvg: { fontFamily: ProfileFonts.headingExtra, fontSize: 36, color: ProfileColors.ink },
  summaryCount: { fontFamily: ProfileFonts.textSemi, fontSize: 12, color: ProfileColors.muted, marginTop: 3 },
  card: { backgroundColor: ProfileColors.surface, borderRadius: ProfileRadius.card, padding: 16, gap: 8 },
  cardTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  name: { fontFamily: ProfileFonts.textBold, fontSize: 14, color: ProfileColors.ink },
  date: { fontFamily: ProfileFonts.textRegular, fontSize: 11, color: ProfileColors.muted, marginTop: 1 },
  stars: { flexDirection: 'row', gap: 2 },
  text: { fontFamily: ProfileFonts.textRegular, fontSize: 13, lineHeight: 18, color: ProfileColors.ink, fontStyle: 'italic' },
  noText: { fontFamily: ProfileFonts.textRegular, fontSize: 12, color: ProfileColors.muted, fontStyle: 'italic' },
});
