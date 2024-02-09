import moment from "moment";
import React, { useState, useMemo } from "react";
import { ScreenLayout, Text, FormInput, Icon } from "../component";
import { useNavigation, useAppState, useWithLoading, useAppOptions, useAppI18N } from "../hook";
import Select from "react-select";
import {
  Field, FieldProps, Form, Formik, FormikProps,
} from "formik";
import * as yup from "yup";

moment.parseTwoDigitYear = function (yearString: string) {
  return (
    parseInt(yearString) +
    (parseInt(yearString) >= parseInt(moment().format('YY')) ? 1900 : 2000)
  );
};


const customJenderSelectStyles = (isError:boolean = false) => ({
  option: (provided, { data, isDisabled, isFocused, isSelected }) => ({
    ...provided,
    background: isSelected ? 'rgba(42, 68, 236, 0.08)' : isFocused ? 'rgba(143, 155, 179, 0.16)':'rgb(255, 255, 255)',
    ':active': {
      ...provided[':active'],
      backgroundColor:
        !isDisabled && (isSelected ? 'rgba(42, 68, 236, 0.08)' : null),
    },
    color: 'color: rgb(34, 43, 69)',
    padding: '12px 12px',
    fontSize: '15px',
  }),
  input: (provided, state) => ({
    ...provided,
  }),
  menu: (provided, state) => ({
    ...provided,
    width: '100%',
  }),
  menuList: (provided, state) => ({
    ...provided,
    width: '100%',
    // zIndex: 999999999999,
    paddingTop: '0px',
    paddingBottom: '0px',
  }),
  indicatorSeparator: (provided, state) => ({
    ...provided,
    backgroundColor: 'rgb(255, 255, 255)'
  }),
  group: (provided, state) => ({
    ...provided,
    width: '100%',
    // zIndex: 999999999999,
  }),

  control: (provided, state) => ({
    ...provided,
    height: '48px',
    paddingLeft: '6px',
    borderColor:  isError ? 'red' :'rgb(204, 204, 204)',
    boxShadow: 'none',
    fontSize: '15px',
    ':hover': {
      ...provided[':hover'],
      borderColor: 'rgb(204, 204, 204)',
    },
  }),
});

export const RegisterDetailScreen: React.FunctionComponent = () => {
  // state
  const { formatMessage: f } = useAppI18N();
  const [state, dispatch] = useAppState();
  const [options] = useAppOptions();
  const tmpState = state.session.register || {};
  const tmpClaims = tmpState.claims || {};
  const tmpCreds = tmpState.credentials || {};
  const tmpBirthdate = tmpClaims.birthdate ? moment(tmpClaims.birthdate, "YYYY-MM-DD") : null;
  const [payload, setPayload] = useState({
    phone_number: tmpClaims.phone_number || "",
    birthdate: {
      year: tmpBirthdate ? tmpBirthdate.format("YYYY") : "",
      month: tmpBirthdate ? tmpBirthdate.format("M"): "",
      day: tmpBirthdate ? tmpBirthdate.format("D") : "",
    },
    gender: tmpClaims.gender || "",
  });

  const genderData = [{
    value: "male",
    text: f({id: "payload.gender.male"}),
    label: f({id: "payload.gender.male"}),
  }, {
    value: "female",
    text: f({id: "payload.gender.female"}),
    label: f({id: "payload.gender.female"}),
  }, {
    value: "other",
    text: f({id: "payload.gender.other"}),
    label: f({id: "payload.gender.other"}),
  }];

  const payloadLabels = {
    claims: {
      phone_number: f({id: "payload.phoneNumber"}),
      birthdate: f({id: "payload.birthdate"}),
      gender: f({id: "payload.gender"}),
      "gender.expected": genderData.map(d => d.text).join(", "),
    },
  };

  const phoneNumberVerified = state.session.verifyPhone && state.session.verifyPhone.phoneNumber === payload.phone_number && state.session.verifyPhone.verified;
  const phoneNumberRequired = state.metadata.mandatoryScopes.includes("phone");

  // handlers
  const { nav } = useNavigation();
  const {loading, errors, setErrors, withLoading} = useWithLoading();
  const [handlePayloadSubmit, handlePayloadSubmitLoading] = withLoading(async () => {
    const { phone_number, birthdate, gender } = payload;
    const birthdateStr = birthdate.year && birthdate.month && birthdate.day ? `${birthdate.year}-${birthdate.month}-${birthdate.day}` : "";
    const brithdateIns = moment(birthdateStr, "YYYY-MM-DD");
    const data = {
      submit: false,
      claims: {
        ...tmpClaims,
        phone_number: phone_number ? `${options.locale.region}|${phone_number}` : undefined,
        birthdate: brithdateIns.isValid() ? brithdateIns.format("YYYY-MM-DD") : birthdateStr,
        gender,
      },
      credentials: tmpCreds,
      scope: ["email", "profile", "birthdate", "gender"].concat((phoneNumberRequired || phone_number) ? "phone" : []),
    };

    return dispatch("register.submit", data, payloadLabels)
      .then((s) => {
        setErrors({});
        // set normalized phone number
        setPayload(p => ({ ...p, phone_number: s.session.register.claims.phone_number || "" }));

        // verify email
        if (data.claims.phone_number && !options.register.skipPhoneVerification && !phoneNumberVerified) {
          return dispatch("verify_phone.check_phone", {
            phone_number: data.claims.phone_number,
            registered: false,
          }, {
            phone_number: payloadLabels.claims.phone_number,
          })
            .then(() => {
              nav.navigate("verify_phone.verify", {
                callback: "register",
              });
            });

        // register user
        } else {
          return dispatch("register.submit", {
            ...data,
            register: true,
          }, payloadLabels)
            .then(() => {
              nav.navigate("register.end");
            });
        }
      })
      .catch(errs => setErrors(errs));
  }, [payload, options]);

  const [handleCancel, handleCancelLoading] = withLoading(() => {
    nav.navigate("register.index");
    setErrors({});
  }, []);

  const userDetailSchema = useMemo(() => yup.object().shape({
    phone_number: yup.string().optional().matches(/^(01|\+82\s1)([0|1|6|7|8|9])-?([0-9]{3,4})-?([0-9]{4})$/, f({id: "register.validation.phone"})),
    birthDigit: yup.string().test(`test-date-pattern`, f({id: "register.validation.birthDay"}), function (value) {
      const { path, createError } = this;
      return (
        moment(value, 'YYMMDD', true).isValid() ||
        createError({ path, message: f({id: "register.validation.birthDay"})})
      );
    }).required(),
    birthdate: yup.string().required(f({id: "register.validation.birthDay"})).matches(/^\d{4}-(0[1-9]|1[012])-(0[1-9]|[12][0-9]|3[01])$/, f({id: "register.validation.birthDay"})),
    gender: yup.string().required(f({id: "register.validation.gender"})).oneOf(['male', 'female', 'other', null], f({id: "register.validation.gender"}))
  }), [f]);

  // render
  return (
    <Formik
        enableReinitialize={false}
        initialValues={{
          phone_number: tmpClaims.phone_number || "",
          birthDigit: tmpBirthdate ? tmpBirthdate.format("YYMMDD") : "",
          birthdate: tmpBirthdate ? `${tmpBirthdate.format("YYYY")}-${tmpBirthdate.format("M")}-tmpBirthdate.format("D")` : "",
          gender: tmpClaims.gender || "",
        }}
        validationSchema={userDetailSchema}
        onSubmit={(values, { setSubmitting, setFieldError }) => {
          setSubmitting(true);
          handlePayloadSubmit();
          setTimeout(() => {
            setSubmitting(false);
          }, 1000);
        }}
      >
      {(formik: FormikProps<any>) => (
        <>
          <ScreenLayout
            title={f({id: "register.signUp"})}
            subtitle={tmpClaims.email}
            loading={loading}
            error={errors.global}
            buttons={[
              {
                status: "primary",
                children: f({id: "button.continue"}),
                onPress: formik.submitForm,
                loading: handlePayloadSubmitLoading,
                tabIndex: 68,
              },
              {
                children: f({id: "button.cancel"}),
                onPress: handleCancel,
                loading: handleCancelLoading,
                tabIndex: 69,
              },
            ]}
            containerStyle={{
              paddingBottom: 40
            }}
          >
            <Text style={{marginBottom: 30}}>
              {f({id: "register.pleaseEnterPhoneNumber"})}
            </Text>

            <Form>
            <Field name="phone_number">
                  {({
                    field,
                    meta: {
                      touched: fieldTouched, error,
                    },
                  }: FieldProps<string>) => (
                    <FormInput
                      autoFocus={!payload.phone_number}
                      tabIndex={61}
                      label={`${payloadLabels.claims.phone_number}${phoneNumberRequired ? "" : ` (${f({id: "payload.optional"})})`}`}
                      placeholder={f({id: "placeholder.phoneNumber"}, { region: options.locale.region })}
                      blurOnSubmit={false}
                      keyboardType={"phone-pad"}
                      autoCompleteType={"tel"}
                      value={field.value}
                      setValue={v => {
                        formik.setFieldValue("phone_number", v);
                        setPayload(p => ({...p, phone_number: v}));
                      }}
                      error={formik.submitCount > 0 && ((fieldTouched && error) || errors["claims.phone_number"])}
                      // onEnter={handlePayloadSubmit}
                      accessoryRight={phoneNumberVerified ? (evaProps) => <Icon {...evaProps} name={"checkmark-circle-2-outline"}/> : undefined}
                      style={{marginBottom: 15}}
                    />
                 )}
            </Field>
              <Field
                name="birthDigit"
                validate={()=> {}}
              >
                  {({
                    field,
                    meta: {
                      touched: fieldTouched, error,
                    },
                  }: FieldProps<string>) => (
                    <FormInput
                      tabIndex={64}
                      keyboardType={"numeric"}
                      label={payloadLabels.claims.birthdate}
                      placeholder={f({id: "placeholder.birthDay"})}
                      value={field.value}
                      setValue={async (v) => {
                        await formik.setFieldValue("birthDigit", v);
                        await formik.setFieldValue("birthdate", moment(v, 'YYMMDD').format('YYYY-MM-DD'));
                        await setPayload(p => ({...p, birthdate: {...p.birthdate,
                          year: moment(v, 'YYMMDD').format('YYYY'),
                          month: moment(v, 'YYMMDD').format('MM'),
                          day: moment(v, 'YYMMDD').format('DD')
                        }}))
                      }}
                      error={formik.submitCount > 0 && (formik.getFieldMeta("birthDigit").error || errors["claims.birthDigit"])}
                      style={{marginBottom: 16}}
                    />
                  )}
              </Field>
              <Field name="birthdate" validate={(value, props) => {
                const errors: Record<string, string> = {};
                if(!moment(value).isValid() && formik.submitCount > 0) {
                  errors.birthdate = "wrong date"
                }
              }}>
                  {({
                    field,
                    meta: {
                      touched: fieldTouched, error,
                    },
                  }: FieldProps<string>) => (
                    <></>
                  )}
                </Field>
            <Text style={{
                  color: "rgb(143, 155, 179)",
                  fontSize: 12,
                  fontWeight: "800",
                  marginBottom: 4,
              }}
              >
              {f({id: "register.gender"})}
            </Text>
            <Field name="gender">
                  {({
                    field,
                    meta: {
                      touched: fieldTouched, error,
                    },
                  }: FieldProps<string>) => (
                    <>
                      <Select
                        tabIndex={65}
                        errorText={true}
                        onChange={(v) =>{
                          formik.setFieldValue("gender", v.value);
                          setPayload(p => ({...p, gender: v.value}))
                        }}
                        isSearchable={false}
                        placeholder={f({id: "placeholder.gender"})}
                        width={'100%'}
                        styles={customJenderSelectStyles((formik.submitCount > 0 && error) || errors["claims.gender"])}
                        options={genderData}
                        menuPlacement={'top'}
                      />
                      { formik.submitCount > 0 && error && (
                        <Text category={"c1"} status={"danger"}>{error}</Text>
                      )}
                    </>
                  )}
              </Field>
            </Form>
          </ScreenLayout>
        </>
      )}
      </Formik>
  );
};
