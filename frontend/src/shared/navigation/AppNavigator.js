// ============================================================================
// Role-based routing
//
// Four roles, four different home screens. The role comes from the server on
// the user record, never from anything the app decides for itself.
// ============================================================================

import { createNativeStackNavigator } from '@react-navigation/native-stack';

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
import { useAuth } from '../auth/AuthContext';
import { AdminHomeScreen } from '../screens/AdminHomeScreen';

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
    </Stack.Navigator>
  );
}

function AdminNavigator() {
  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen name="AdminHome" component={AdminHomeScreen} />
      <Stack.Screen name="CaregiverVerification" component={CaregiverVerificationScreen} />
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
      return <ElderlyNavigator />;
  }
}
