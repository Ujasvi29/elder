// ============================================================================
// Role-based routing
//
// Four roles, four different home screens. The role comes from the server on
// the user record, never from anything the app decides for itself.
//
// A fifth branch exists for the case where that role is missing or unknown —
// see UnknownRoleNavigator at the bottom. It is not a role, it is the refusal
// to guess one.
// ============================================================================

import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CaregiverHomeScreen } from '../../caregiver/screens/CaregiverHomeScreen';
import { ElderlyHomeScreen } from '../../emergency/screens/ElderlyHomeScreen';
import { FamilyHomeScreen } from '../../emergency/screens/FamilyHomeScreen';
import { AmbulanceBookingScreen } from '../../emergency/screens/AmbulanceBookingScreen';
import { AmbulanceStatusScreen } from '../../emergency/screens/AmbulanceStatusScreen';
import { DisasterAlertsScreen } from '../../emergency/screens/DisasterAlertsScreen';
import { DisasterDetailScreen } from '../../emergency/screens/DisasterDetailScreen';
import { ResponseCenterScreen } from '../../emergency/screens/ResponseCenterScreen';
import { FallDetectionScreen } from '../../emergency/screens/FallDetectionScreen';
import { EmergencyContactsScreen } from '../../emergency/screens/EmergencyContactsScreen';
import { GeofencesScreen } from '../../emergency/screens/GeofencesScreen';
import { GeofenceFormScreen } from '../../emergency/screens/GeofenceFormScreen';
import { FamilySafetyScreen } from '../../emergency/screens/FamilySafetyScreen';
import { FamilyLiveMapScreen } from '../../emergency/screens/FamilyLiveMapScreen';
import { CaregiverSearchScreen } from '../../caregiver/screens/CaregiverSearchScreen';
import { CaregiverDetailScreen } from '../../caregiver/screens/CaregiverDetailScreen';
import { BookingFormScreen } from '../../caregiver/screens/BookingFormScreen';
import { BookingsScreen } from '../../caregiver/screens/BookingsScreen';
import { CaregiverProfileScreen } from '../../caregiver/screens/CaregiverProfileScreen';
import { CaregiverBookingsScreen } from '../../caregiver/screens/CaregiverBookingsScreen';
import { CaregiverVerificationScreen } from '../../caregiver/screens/CaregiverVerificationScreen';
import { CaregiverScheduleScreen } from '../../caregiver/screens/CaregiverScheduleScreen';
import { VisitsScreen } from '../../caregiver/screens/VisitsScreen';
import { ScheduleVisitScreen } from '../../caregiver/screens/ScheduleVisitScreen';
import { CarePlanScreen } from '../../caregiver/screens/CarePlanScreen';
import { CarePlanFormScreen } from '../../caregiver/screens/CarePlanFormScreen';
import { ScheduleTasksScreen } from '../../caregiver/screens/ScheduleTasksScreen';
import { TaskFormScreen } from '../../caregiver/screens/TaskFormScreen';
import { ReportScreen } from '../../caregiver/screens/ReportScreen';
import { ReportFormScreen } from '../../caregiver/screens/ReportFormScreen';
import { ReviewFormScreen } from '../../caregiver/screens/ReviewFormScreen';
import { ManageFamilyScreen } from '../../family/screens/ManageFamilyScreen';
import { FamilyLinksScreen } from '../../family/screens/FamilyLinksScreen';
import { NotificationFeedScreen } from '../notifications/screens/NotificationFeedScreen';
import { useAuth } from '../auth/AuthContext';
import { AdminHomeScreen } from '../screens/AdminHomeScreen';
import { UserManagementScreen } from '../../admin/screens/UserManagementScreen';
import { AlertOverviewScreen } from '../../admin/screens/AlertOverviewScreen';
import { colors, spacing, type } from '../ui/theme';

const Stack = createNativeStackNavigator();

const screenOptions = { headerShown: false };

function ElderlyNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="ElderlyHome" component={ElderlyHomeScreen} />
      <Stack.Screen name="AmbulanceBooking" component={AmbulanceBookingScreen} />
      <Stack.Screen name="AmbulanceStatus" component={AmbulanceStatusScreen} />
      <Stack.Screen name="DisasterAlerts" component={DisasterAlertsScreen} />
      <Stack.Screen name="DisasterDetail" component={DisasterDetailScreen} />
      <Stack.Screen name="ResponseCenter" component={ResponseCenterScreen} />
      <Stack.Screen name="FallDetection" component={FallDetectionScreen} />
      <Stack.Screen name="ManageFamily" component={ManageFamilyScreen} />
      <Stack.Screen name="EmergencyContacts" component={EmergencyContactsScreen} />
      <Stack.Screen name="Geofences" component={GeofencesScreen} />
      <Stack.Screen name="GeofenceForm" component={GeofenceFormScreen} />
      <Stack.Screen name="CaregiverSearch" component={CaregiverSearchScreen} />
      <Stack.Screen name="CaregiverDetail" component={CaregiverDetailScreen} />
      <Stack.Screen name="BookingForm" component={BookingFormScreen} />
      <Stack.Screen name="Bookings" component={BookingsScreen} />
      <Stack.Screen name="Visits" component={VisitsScreen} />
      <Stack.Screen name="ScheduleVisit" component={ScheduleVisitScreen} />
      <Stack.Screen name="CarePlan" component={CarePlanScreen} />
      <Stack.Screen name="CarePlanForm" component={CarePlanFormScreen} />
      <Stack.Screen name="ScheduleTasks" component={ScheduleTasksScreen} />
      <Stack.Screen name="TaskForm" component={TaskFormScreen} />
      <Stack.Screen name="Report" component={ReportScreen} />
      <Stack.Screen name="ReviewForm" component={ReviewFormScreen} />
      <Stack.Screen name="NotificationFeed" component={NotificationFeedScreen} />
    </Stack.Navigator>
  );
}

function FamilyNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="FamilyHome" component={FamilyHomeScreen} />
      <Stack.Screen name="AmbulanceBooking" component={AmbulanceBookingScreen} />
      <Stack.Screen name="AmbulanceStatus" component={AmbulanceStatusScreen} />
      <Stack.Screen name="DisasterAlerts" component={DisasterAlertsScreen} />
      <Stack.Screen name="DisasterDetail" component={DisasterDetailScreen} />
      <Stack.Screen name="ResponseCenter" component={ResponseCenterScreen} />
      <Stack.Screen name="FallDetection" component={FallDetectionScreen} />
      <Stack.Screen name="FamilyLinks" component={FamilyLinksScreen} />
      <Stack.Screen name="SafetyStatus" component={FamilySafetyScreen} />
      {/* Family only. An elderly user watching their own position live isn't
          a thing this product has asked for, and the screen's permission model
          (an active link with can_view_location) is written for a viewer who
          isn't the subject. */}
      <Stack.Screen name="LiveMap" component={FamilyLiveMapScreen} />
      <Stack.Screen name="Geofences" component={GeofencesScreen} />
      <Stack.Screen name="GeofenceForm" component={GeofenceFormScreen} />
      <Stack.Screen name="CaregiverSearch" component={CaregiverSearchScreen} />
      <Stack.Screen name="CaregiverDetail" component={CaregiverDetailScreen} />
      <Stack.Screen name="BookingForm" component={BookingFormScreen} />
      <Stack.Screen name="Bookings" component={BookingsScreen} />
      <Stack.Screen name="Visits" component={VisitsScreen} />
      <Stack.Screen name="ScheduleVisit" component={ScheduleVisitScreen} />
      <Stack.Screen name="CarePlan" component={CarePlanScreen} />
      <Stack.Screen name="CarePlanForm" component={CarePlanFormScreen} />
      <Stack.Screen name="ScheduleTasks" component={ScheduleTasksScreen} />
      <Stack.Screen name="TaskForm" component={TaskFormScreen} />
      <Stack.Screen name="Report" component={ReportScreen} />
      <Stack.Screen name="ReviewForm" component={ReviewFormScreen} />
      <Stack.Screen name="NotificationFeed" component={NotificationFeedScreen} />
    </Stack.Navigator>
  );
}

function CaregiverNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="CaregiverHome" component={CaregiverHomeScreen} />
      <Stack.Screen name="CaregiverProfile" component={CaregiverProfileScreen} />
      <Stack.Screen name="CaregiverBookings" component={CaregiverBookingsScreen} />
      <Stack.Screen name="CaregiverSchedule" component={CaregiverScheduleScreen} />
      <Stack.Screen name="ScheduleVisit" component={ScheduleVisitScreen} />
      <Stack.Screen name="CarePlan" component={CarePlanScreen} />
      <Stack.Screen name="ScheduleTasks" component={ScheduleTasksScreen} />
      <Stack.Screen name="Report" component={ReportScreen} />
      <Stack.Screen name="ReportForm" component={ReportFormScreen} />
      <Stack.Screen name="NotificationFeed" component={NotificationFeedScreen} />
    </Stack.Navigator>
  );
}

function AdminNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="AdminHome" component={AdminHomeScreen} />
      <Stack.Screen name="CaregiverVerification" component={CaregiverVerificationScreen} />
      <Stack.Screen name="UserManagement" component={UserManagementScreen} />
      <Stack.Screen name="AlertOverview" component={AlertOverviewScreen} />
    </Stack.Navigator>
  );
}

// Shown when the signed-in user's role is missing or is a value this build
// does not know. Previously this case fell through to ElderlyNavigator, which
// meant an unrecognised role was handed the elderly app — including its SOS
// button — while the person's actual permissions were something else entirely.
// Failing visibly is the safer default: a screen that says what went wrong and
// offers the one action that always works beats silently impersonating a role.
function UnknownRoleScreen() {
  const { user, signOut } = useAuth();

  return (
    <SafeAreaView style={unknownRoleStyles.safe} edges={['top', 'bottom']}>
      <View style={unknownRoleStyles.content}>
        <Text style={unknownRoleStyles.title}>Something's wrong with this account</Text>
        <Text style={unknownRoleStyles.body}>
          We couldn't tell whether this account belongs to an elderly person, a family member, a
          caregiver or an administrator, so we haven't opened any of those screens.
        </Text>
        <Text style={unknownRoleStyles.body}>
          Please sign out and sign in again. If it keeps happening, contact support — nothing is
          wrong with your data.
        </Text>
        {user?.role ? (
          <Text style={unknownRoleStyles.detail}>Reported account type: {String(user.role)}</Text>
        ) : (
          <Text style={unknownRoleStyles.detail}>No account type was returned for this account.</Text>
        )}

        <Pressable style={unknownRoleStyles.signOutButton} onPress={signOut} accessibilityRole="button">
          <Text style={unknownRoleStyles.signOutText}>Sign out</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const unknownRoleStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  content: { flex: 1, padding: spacing.lg, gap: spacing.md, justifyContent: 'center' },
  title: { fontSize: type.title, fontWeight: '900', color: colors.text },
  body: { fontSize: type.body, color: colors.text, lineHeight: 22 },
  detail: { fontSize: type.small, color: colors.textMuted },
  signOutButton: {
    marginTop: spacing.md,
    alignItems: 'center',
    paddingVertical: spacing.md,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  signOutText: { fontSize: type.body, color: colors.danger, fontWeight: '700' },
});

function UnknownRoleNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="UnknownRole" component={UnknownRoleScreen} />
    </Stack.Navigator>
  );
}

export function AppNavigator() {
  const { user } = useAuth();

  switch (user?.role) {
    case 'elderly':
      return <ElderlyNavigator />;
    case 'family':
      return <FamilyNavigator />;
    case 'caregiver':
      return <CaregiverNavigator />;
    case 'admin':
      return <AdminNavigator />;
    default:
      return <UnknownRoleNavigator />;
  }
}
