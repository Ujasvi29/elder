// ============================================================================
// Find a Caregiver — elderly and family, shared screen
//
// route.params.elderlyUserId is null when the elderly user is searching for
// themselves, and set when a family member is searching on a linked elderly
// user's behalf (reachable from FamilyLinksScreen/FamilyHomeScreen for any
// active link — booking only requests a caregiver, payment is arranged
// offline, so it isn't gated on canManageCaregivers). Carried forward through Detail and BookingForm
// so the eventual POST /caregiver/bookings knows who the booking is for.
//
// city/language/specialization have no canonical list anywhere in the
// backend — caregivers self-enter all three as free text — so these stay
// plain text filters rather than pickers. minRating is a plain-language
// button row instead, same reasoning as the geofence radius picker: nobody
// should have to type "4.5" to mean "at least 4.5 stars."
// ============================================================================

import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { searchCaregivers } from '../api/caregivers';
import { NetworkError } from '../../shared/api/client';
import { colors, spacing, type } from '../../shared/ui/theme';
import { RATING_OPTIONS } from '../bookingFormat';

const PAGE_SIZE = 20;

export function CaregiverSearchScreen({ navigation, route }) {
  const { elderlyUserId, elderlyName } = route.params || {};

  const [city, setCity] = useState('');
  const [language, setLanguage] = useState('');
  const [specialization, setSpecialization] = useState('');
  const [minRating, setMinRating] = useState(null);

  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [banner, setBanner] = useState(null);

  const runSearch = useCallback(
    async (nextPage) => {
      const isFirstPage = nextPage === 1;
      isFirstPage ? setLoading(true) : setLoadingMore(true);
      try {
        const result = await searchCaregivers({
          city: city.trim() || undefined,
          language: language.trim() || undefined,
          specialization: specialization.trim() || undefined,
          minRating: minRating || undefined,
          page: nextPage,
          limit: PAGE_SIZE,
        });
        setResults((prev) => (isFirstPage ? result.caregivers : [...prev, ...result.caregivers]));
        setTotal(result.total);
        setPage(nextPage);
        setBanner(null);
      } catch (err) {
        setBanner({
          kind: 'error',
          text: err instanceof NetworkError ? 'Could not reach the server.' : 'Could not search for caregivers.',
        });
      } finally {
        isFirstPage ? setLoading(false) : setLoadingMore(false);
      }
    },
    [city, language, specialization, minRating]
  );

  // Only ever runs the default (unfiltered) search on mount — subsequent
  // searches are explicit taps on "Search", not a re-run on every keystroke.
  useEffect(() => {
    runSearch(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Pressable onPress={() => navigation.goBack()} accessibilityRole="button" style={styles.backRow}>
          <Text style={styles.backText}>‹ Back</Text>
        </Pressable>

        <Text style={styles.title}>Find a Caregiver</Text>
        <Text style={styles.subtitle}>
          {elderlyName ? `Search for a caregiver for ${elderlyName}.` : 'Search for a caregiver to help you.'}
        </Text>

        <View style={styles.filterCard}>
          <View style={styles.inputGroup}>
            <Text style={styles.label}>City</Text>
            <TextInput
              style={styles.input}
              value={city}
              onChangeText={setCity}
              placeholder="e.g. Bengaluru"
              placeholderTextColor={colors.textMuted}
              autoCapitalize="words"
              accessibilityLabel="City"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Language</Text>
            <TextInput
              style={styles.input}
              value={language}
              onChangeText={setLanguage}
              placeholder="e.g. Hindi"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Language"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Specialization</Text>
            <TextInput
              style={styles.input}
              value={specialization}
              onChangeText={setSpecialization}
              placeholder="e.g. Dementia care"
              placeholderTextColor={colors.textMuted}
              accessibilityLabel="Specialization"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Minimum rating</Text>
            <View style={styles.ratingOptions}>
              {RATING_OPTIONS.map((opt) => {
                const selected = minRating === opt.value;
                return (
                  <Pressable
                    key={opt.label}
                    onPress={() => setMinRating(opt.value)}
                    accessibilityRole="button"
                    style={[styles.ratingOption, selected && styles.ratingOptionSelected]}
                  >
                    <Text style={[styles.ratingOptionText, selected && styles.ratingOptionTextSelected]}>{opt.label}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.searchButton, pressed && styles.searchButtonPressed]}
            onPress={() => runSearch(1)}
            accessibilityRole="button"
          >
            <Text style={styles.searchButtonText}>Search</Text>
          </Pressable>
        </View>

        {banner && (
          <View style={[styles.banner, styles.bannerError]}>
            <Text style={[styles.bannerText, styles.bannerTextError]}>{banner.text}</Text>
          </View>
        )}

        {loading && <ActivityIndicator size="large" color={colors.primary} style={styles.spinner} />}

        {!loading && results.length === 0 && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyText}>No caregivers matched. Try widening your search.</Text>
          </View>
        )}

        {!loading &&
          results.map((cg) => (
            <Pressable
              key={cg.id}
              style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
              onPress={() => navigation.navigate('CaregiverDetail', { caregiverId: cg.id, elderlyUserId, elderlyName })}
              accessibilityRole="button"
            >
              <Text style={styles.cardName}>{cg.fullName}</Text>
              <Text style={styles.cardMeta}>
                ⭐ {cg.averageRating.toFixed(1)} ({cg.totalReviews} review{cg.totalReviews === 1 ? '' : 's'})
                {cg.hourlyRate != null ? ` · ₹${cg.hourlyRate}/hr` : ''}
              </Text>
              {cg.serviceAreaCity ? <Text style={styles.cardMeta}>{cg.serviceAreaCity}</Text> : null}
              {cg.specializations.length > 0 ? (
                <Text style={styles.cardSpecializations}>{cg.specializations.join(', ')}</Text>
              ) : null}
            </Pressable>
          ))}

        {!loading && results.length < total && (
          <Pressable
            style={({ pressed }) => [styles.loadMoreButton, pressed && styles.loadMoreButtonPressed]}
            onPress={() => runSearch(page + 1)}
            disabled={loadingMore}
            accessibilityRole="button"
          >
            {loadingMore ? <ActivityIndicator size="small" color={colors.primary} /> : <Text style={styles.loadMoreText}>Show More Results</Text>}
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, gap: spacing.md, paddingBottom: spacing.xl * 2 },
  backRow: { paddingVertical: spacing.xs },
  backText: { fontSize: type.body, color: colors.primary, fontWeight: '700' },
  title: { fontSize: type.title, fontWeight: '900', color: colors.text },
  subtitle: { fontSize: type.body, color: colors.textMuted, lineHeight: 23 },
  filterCard: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: spacing.md,
  },
  inputGroup: { gap: spacing.xs },
  label: { fontSize: type.body - 1, fontWeight: '700', color: colors.text },
  input: {
    backgroundColor: colors.background,
    borderWidth: 1.5,
    borderColor: colors.border,
    borderRadius: 12,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    fontSize: type.body,
    color: colors.text,
  },
  ratingOptions: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  ratingOption: {
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.background,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: spacing.sm,
  },
  ratingOptionSelected: { borderColor: colors.primary, backgroundColor: '#EFF6FF' },
  ratingOptionText: { fontSize: type.small + 1, fontWeight: '700', color: colors.text },
  ratingOptionTextSelected: { color: colors.primary },
  searchButton: { backgroundColor: colors.primary, borderRadius: 12, paddingVertical: 14, alignItems: 'center' },
  searchButtonPressed: { backgroundColor: '#1D4ED8' },
  searchButtonText: { fontSize: type.body - 1, fontWeight: '800', color: '#FFFFFF' },
  banner: { borderRadius: 12, padding: spacing.md, borderWidth: 1.5 },
  bannerError: { backgroundColor: '#FEE2E2', borderColor: colors.danger },
  bannerText: { fontSize: type.body - 1, fontWeight: '700', textAlign: 'center' },
  bannerTextError: { color: colors.danger },
  spinner: { marginVertical: spacing.md },
  emptyCard: { backgroundColor: colors.surface, borderRadius: 16, borderWidth: 1.5, borderColor: colors.border, padding: spacing.lg },
  emptyText: { fontSize: type.body, color: colors.textMuted, lineHeight: 23 },
  card: {
    backgroundColor: colors.surface,
    borderRadius: 18,
    borderWidth: 1.5,
    borderColor: colors.border,
    padding: spacing.md,
    gap: 4,
  },
  cardPressed: { opacity: 0.9 },
  cardName: { fontSize: type.heading, fontWeight: '800', color: colors.text },
  cardMeta: { fontSize: type.body - 1, color: colors.textMuted },
  cardSpecializations: { fontSize: type.small + 1, color: colors.primary, fontWeight: '600', marginTop: 2 },
  loadMoreButton: {
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingVertical: 14,
    alignItems: 'center',
  },
  loadMoreButtonPressed: { backgroundColor: colors.border },
  loadMoreText: { fontSize: type.body - 1, fontWeight: '700', color: colors.primary },
});
